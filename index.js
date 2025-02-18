const express = require('express');
const axios = require('axios');
const puppeteer = require('puppeteer');
const cron = require('node-cron');
const { WebClient } = require('@slack/web-api');
const fs = require('fs');
const path = require('path');

// require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const KNOWN_PIXELS = [
    'awin1.com', 'impactradius.com', 'cj.com', 'rakuten.com', 'doubleclick.net', 'adroll.com',
    'googletagmanager.com', 'google-analytics.com', 'criteo.com', 'bing.com', 'taboola.com',
    'outbrain.com', 'facebook.com', 'twitter.com', 'linkedin.com', 'snapchat.com'
];

const extractFieldValidation = async (input) => {
    return await input.evaluate(el => ({
        name: el.name || el.id || 'Unnamed Field',
        type: el.type,
        attributes: {
            required: el.hasAttribute('required'),
            pattern: el.getAttribute('pattern') || null,
            minlength: el.getAttribute('minlength') || null,
            maxlength: el.getAttribute('maxlength') || null,
            ariaInvalid: el.getAttribute('aria-invalid') || null
        }
    }));
};

const detectValidationMessages = async (page) => {
    return await page.$$eval(
        '.is-invalid, .error, .invalid-feedback, .help-block, [aria-invalid="true"], [data-error], div[role="alert"]',
        elements => elements.map(el => el.innerText.trim()).filter(text => text.length > 0)
    );
};

const scanFormFields = async (form, page) => {
    let validationLog = [];
    const inputs = await form.$$('input, textarea, select');
    let formHasValidation = false;

    for (const input of inputs) {
        const fieldData = await extractFieldValidation(input);
        
        await input.focus();
        await page.keyboard.type("test");
        await input.evaluate(el => el.blur());
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        fieldData.validationMessages = await detectValidationMessages(page);
        if (fieldData.validationMessages.length === 0) {
            fieldData.validationMessages = 'None';
        } else {
            formHasValidation = true;
        }
        validationLog.push(fieldData);
    }
    return { validationLog, formHasValidation };
};

const detectAffiliatePixels = async (page) => {
    const scripts = await page.$$eval('script', scripts => scripts.map(s => s.src));
    return scripts.filter(src => 
        KNOWN_PIXELS.some(pixel => src.includes(pixel)) || 
        src.toLowerCase().includes("pixel") || 
        /gtag\/js|fbevents\.js|tiktok\/pixel\.js|bing\/conversion.js/.test(src)
    );
};

const calculateFraudScore = (hasValidation, detectedPixels) => {
    let fraudScore = 0;
    if (!hasValidation) fraudScore += 100;
    if (detectedPixels.length > 0) fraudScore += detectedPixels.length * 10;
    return fraudScore;
};

const scanWebsite = async (url) => {
    console.log(`Scanning: ${url}`);
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: [
            "--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled",
            "--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    
    let externalValidationURLs = new Set();
    let visitedUrls = new Set();
    let currentUrl = url;
    
    page.on('request', request => {
        const requestUrl = request.url();
        if (/validate|verification|check|api|lookup/i.test(requestUrl)) {
            externalValidationURLs.add(requestUrl);
        }
    });
    
    while (currentUrl && !visitedUrls.has(currentUrl)) {
        visitedUrls.add(currentUrl);
        try {
            console.log(`Visiting: ${currentUrl}`);
            await page.goto(currentUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (error) {
            console.log(`⚠️ Timeout loading ${currentUrl}`);
            break;
        }
        
        let forms = await page.$$('form');
        let validationLog = [];
        let siteHasValidation = false;
        
        for (const form of forms) {
            const { validationLog: formValidationLog, formHasValidation } = await scanFormFields(form, page);
            validationLog.push(formValidationLog);
            if (formHasValidation) siteHasValidation = true;
        }
        
        const detectedPixels = await detectAffiliatePixels(page);
        const fraudScore = calculateFraudScore(siteHasValidation, detectedPixels);
        
        console.log("\n===== Scan Results =====");
        console.log(`Website: ${currentUrl}`);
        console.log(`Forms Found: ${forms.length}`);
        console.log(`Fraud Risk Score: ${fraudScore} ${fraudScore > 100 ? '(Critical Risk 🚨)' : fraudScore > 50 ? '(High Risk ⚠️)' : '(Low Risk ✅)'}`);
        console.log("Validation Report:");
        validationLog.forEach((fields, formIndex) => {
            console.log(`Form ${formIndex + 1}:`);
            fields.forEach((log, index) => {
                console.log(`${index + 1}. Field: ${log.name} (Type: ${log.type})`);
                console.log(`   - HTML Attributes: ${JSON.stringify(log.attributes)}`);
                console.log(`   - Validation Messages: ${Array.isArray(log.validationMessages) ? log.validationMessages.join('; ') : log.validationMessages}`);
            });
        });
        if (externalValidationURLs.size > 0) {
            console.log("🚀 External API Validation Detected:");
            console.log([...externalValidationURLs].join('\n'));
        }
        console.log("Affiliate Pixels Detected:");
        console.log(detectedPixels.length > 0 ? detectedPixels.join('\n') : 'None');
        console.log("=======================\n");
        
        const nextUrl = page.url();
        if (nextUrl !== currentUrl) {
            currentUrl = nextUrl;
        } else {
            break;
        }
    }
    
    await browser.close();
};



// Load URLs from external JSON configuration file
const configPath = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error("⚠️ Failed to load config.json. Ensure the file exists and is formatted correctly.");
    process.exit(1);
}

(async () => {
    for (const site of config.sites) {
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
