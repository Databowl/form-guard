const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const { WebClient } = require('@slack/web-api');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const websites = [
    'https://www.switchexperts.co.uk/ggbb2/?utm_source=INT_BB_Organic',
    // 'https://www.quidco.com/',
];

// Function to scan a website
const scanWebsite = async (url) => {
    console.log(`Scanning: ${url}`);
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            "--no-sandbox", 
            "--disable-setuid-sandbox", 
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process"
        ]
    });
    
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    
    let externalValidationDetected = false;
    let externalValidationURLs = new Set();
    let validationMessages = new Set();
    
    page.on('request', (request) => {
        const url = request.url();
        if (/validate|verification|check|api|lookup/i.test(url)) {
            externalValidationDetected = true;
            externalValidationURLs.add(url);
        }
    });
    
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (error) {
        console.log(`⚠️ Timeout loading ${url}`);
        await browser.close();
        return;
    }
    
    let fraudScore = 0;
    let hasVerification = false;
    let forms = await page.$$('form');
    
    if (forms.length > 0) {
        for (const form of forms) {
            const inputField = await form.$('input[type=text], input[name*=email], input[name*=phone], input');
            const nextButton = await form.$('button[type=submit], button[class*=next], input[type=submit]');
            
            if (inputField) {
                await inputField.focus();
                await page.keyboard.type("test@example.com");
                await inputField.evaluate(el => el.blur());
                await new Promise(resolve => setTimeout(resolve, 3000)); // Short wait before checking validation
                
                if (nextButton) {
                    await page.evaluate(el => el.scrollIntoView(), nextButton);
                    await page.waitForFunction(el => el.offsetParent !== null, {}, nextButton).catch(() => console.log("⚠️ Next button not visible"));
                    try {
                        await page.evaluate(el => el.click(), nextButton);
                        console.log("🔄 Clicked 'Next' button to trigger validation");
                    } catch (error) {
                        console.log("⚠️ Failed to click button, skipping...");
                    }
                }
                
                await new Promise(resolve => setTimeout(resolve, 7000)); // Longer wait for AJAX validation
                
                // Check for dynamic validation messages
                const validationElements = await page.$$eval(
                    '.is-invalid, .error, .invalid-feedback, .help-block, [aria-invalid="true"], [data-error], div[role="alert"]',
                    elements => elements.map(el => el.innerText.trim()).filter(text => text.length > 0)
                );
                
                if (validationElements.length > 0) {
                    hasVerification = true;
                    validationElements.forEach(msg => validationMessages.add(msg));
                    console.log("✅ JavaScript Validation Detected");
                }
            }
        }
    }
    
    const scripts = await page.$$eval('script', (scripts) => scripts.map(s => s.src));
    const knownPixels = [
        'awin1.com', 'impactradius.com', 'cj.com', 'rakuten.com', 'doubleclick.net', 'adroll.com',
        'googletagmanager.com', 'google-analytics.com', 'criteo.com', 'bing.com', 'taboola.com',
        'outbrain.com', 'facebook.com', 'twitter.com', 'linkedin.com', 'snapchat.com'
    ];
    
    let detectedPixels = scripts.filter(src => 
        knownPixels.some(pixel => src.includes(pixel)) || 
        src.toLowerCase().includes("pixel") || 
        /gtag\/js|fbevents\.js|tiktok\/pixel\.js|bing\/conversion.js/.test(src)
    );
    
    if (detectedPixels.length > 0) {
        fraudScore += 40;
        fraudScore += (detectedPixels.length - 1) * 10;
    }
    
    const trackingImages = await page.$$eval('img', imgs => 
        imgs.filter(img => (img.width === 1 && img.height === 1)).map(img => img.src)
    );
    
    const inlineScripts = await page.$$eval('script', scripts => 
        scripts.map(script => script.innerText).filter(text => 
            /track|pixel|analytics|conversion/i.test(text)
        )
    );
    
    detectedPixels = [...new Set([...detectedPixels, ...trackingImages, ...inlineScripts])];
    
    let pixelOutput = detectedPixels.length > 0 
        ? detectedPixels.map((pixel, index) => ` ${index + 1}. ${pixel}`).join('\n') 
        : 'None';
    
    let riskLevel = "Low Risk ✅";
    if (fraudScore >= 40 && fraudScore <= 70) riskLevel = "Medium Risk ⚠️";
    if (fraudScore > 80) riskLevel = "High Risk 🔥";
    if (fraudScore > 100) riskLevel = "Critical Risk 🚨";
    
    await browser.close();
    
    console.log("\n===== Scan Results =====");
    console.log(`Website: ${url}`);
    console.log(`Forms Found: ${forms.length}`);
    console.log(`Has Verification: ${hasVerification ? '✅ Yes' : '❌ No'}`);
    console.log("Affiliate Pixels Detected:");
    console.log(pixelOutput);
    console.log(`Fraud Risk Score: ${fraudScore} (${riskLevel})`);
    if (externalValidationDetected) {
        console.log("🚀 External API Validation Detected:");
        console.log([...externalValidationURLs].join('\n'));
    }
    if (validationMessages.size > 0) {
        console.log("🔍 Validation Messages Detected:");
        console.log([...validationMessages].join('\n'));
    }
    console.log("=======================\n");
};





// Run the scan immediately on startup
(async () => {
    console.log("Running initial manual scan...");
    for (const site of websites) {
        await scanWebsite(site);
    }
})();

// Run the scan daily
// cron.schedule('0 8 * * *', async () => {
//     console.log('Running scheduled website scan...');
//     for (const site of websites) {
//         await scanWebsite(site);
//     }
// });

app.listen(PORT, () => {
    console.log(`FormGuard backend running on port ${PORT}`);
});
