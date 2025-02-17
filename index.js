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
    'https://www.tesla.com/en_gb/callback'
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
    
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => console.log(`Timeout loading ${url}`));
    
    // Wait for form elements to load
    await page.waitForSelector('form', { timeout: 10000 }).catch(() => console.log(`No form found on ${url}`));
    
    // Check for form elements
    const forms = await page.$$eval('form', (forms) => forms.length);
    let hasVerification = false;
    // let detectedPixels = [];

    if (forms > 0) {
        hasVerification = await page.evaluate(() => {
            return !!document.querySelector('input[required], input[type=email], input[type=tel], textarea[required], input[name*=captcha]');
        });

        // Simulate a blur event on the first input field and check if validation appears
        const inputField = await page.$('form input');
        if (inputField) {
            await inputField.focus();
            await page.keyboard.type("test"); // Simulate typing
            await inputField.evaluate(el => el.blur()); // Simulate blur event
            
            // Wait for a possible validation message
            await new Promise(resolve => setTimeout(resolve, 2000)); // Allow time for validation to appear
            const validationMessage = await page.evaluate(() => {
                return document.querySelector('.error, .validation-message, .invalid, .help-block') !== null;
            });
            
            if (validationMessage) {
                hasVerification = true;
                console.log("JS Validation Detected");
            }
        }
    }

    // Check for affiliate pixels
    const scripts = await page.$$eval('script', (scripts) => scripts.map(s => s.src));
    const knownPixels = [
        'awin1.com', 'impactradius.com', 'cj.com', 'rakuten.com', 'doubleclick.net', 'adroll.com',
        'googletagmanager.com', 'google-analytics.com', 'criteo.com', 'bing.com', 'taboola.com',
        'outbrain.com', 'facebook.com', 'twitter.com', 'linkedin.com', 'snapchat.com'
    ];

    // Check for known pixels, "pixel" in URL, and common tracking patterns
    let detectedPixels = scripts.filter(src => 
        knownPixels.some(pixel => src.includes(pixel)) || 
        src.toLowerCase().includes("pixel") || 
        /gtag\/js|fbevents\.js|tiktok\/pixel\.js|bing\/conversion.js/.test(src)
    );

   // Detect 1x1 tracking images
    const trackingImages = await page.$$eval('img', imgs => 
        imgs.filter(img => (img.width === 1 && img.height === 1)).map(img => img.src)
    );

       // Detect inline pixel scripts
       const inlineScripts = await page.$$eval('script', scripts => 
        scripts.map(script => script.innerText).filter(text => 
            /track|pixel|analytics|conversion/i.test(text)
        )
    );

    detectedPixels = [...new Set([...detectedPixels, ...trackingImages, ...inlineScripts])];

    await browser.close();
    
    // Console log the results instead of sending a Slack notification
    console.log("\n===== Scan Results =====");
    console.log(`Website: ${url}`);
    console.log(`Forms Found: ${forms}`);
    console.log(`Has Verification: ${hasVerification ? '✅ Yes' : '❌ No'}`);
    console.log(`Affiliate Pixels Detected: ${detectedPixels.length > 0 ? detectedPixels.join(', ') : 'None'}`); 
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
cron.schedule('0 8 * * *', async () => {
    console.log('Running scheduled website scan...');
    for (const site of websites) {
        await scanWebsite(site);
    }
});

app.listen(PORT, () => {
    console.log(`FormGuard backend running on port ${PORT}`);
});
