# FormGuard

## Overview

FormGuard is a web-based tool designed to scan websites for form verification mechanisms and detect the presence of affiliate tracking pixels. It helps identify whether forms have basic validation (such as required fields, email/phone validation, CAPTCHA) and if JavaScript-based validation appears upon interaction. Additionally, it detects tracking scripts related to affiliate networks, which can indicate a higher risk of fraudulent submissions.

## Features

- **Automated website scanning**: Detects forms and checks for verification mechanisms.
- **JavaScript validation detection**: Simulates user interaction to trigger potential validation messages.
- **Affiliate pixel detection**: Identifies tracking scripts from known affiliate networks.
- **Slack notifications**: Sends scan results to a configured Slack channel.
- **Future Feature: Scheduled scanning**: The ability to run daily scans at 8 AM via a cron job (coming soon).
- **Console-based output**: Displays scan results in the terminal.

## Prerequisites

- Install **Node.js** (v20+ recommended) from [Node.js official site](https://nodejs.org/)
- Install **npm** (included with Node.js)

## Installation

1. **Install required dependencies**:
   ```sh
   npm install
   ```

## Configuration

1. Create a `.env` file in the root directory and add:
   ```ini
   SLACK_TOKEN=<your-slack-token>
   SLACK_CHANNEL=<your-slack-channel-id>
   ```
2. Open `index.js` and modify the `websites` array to include the URLs you want to scan:
   ```javascript
   const websites = [
       'https://example.com',
       'https://another-example.com',
       'https://yourwebsite.com'
   ];
   ```

## Running the Project

To start the scanner manually, run:

```sh
node index.js
```

This will scan the listed websites and display results in the terminal.

## Sending Scan Results to Slack

The script is configured to send scan results to a Slack channel. To enable this feature:

1. Ensure you have added your **Slack token** and **channel ID** in the `.env` file.
2. When a scan completes, the script will post:
   - The website URL scanned.
   - Whether forms were found and validated.
   - If affiliate tracking pixels were detected.

## Automating Scans (Future Feature)

The ability to run the scan daily at 8 AM using a cron job will be available in a future update.

## Viewing Logs

If using PM2, check logs with:

```sh
pm2 logs formguard
```

## How It Works

1. **Loads each website** in a headless browser.
2. **Detects forms** and checks for built-in validation.
3. **Simulates user input** on form fields to check if JavaScript validation appears.
4. **Scans scripts for known affiliate tracking pixels.**
5. **Outputs results in the console and optionally sends them to Slack.**

## Contributing

Feel free to suggest improvements or submit pull requests to enhance functionality!

## License

This project is licensed under the MIT License.

