require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const nodemailer = require('nodemailer');

// Configuration
const CONFIG_FILE = 'config.json';
const MAX_RETRIES = 3;

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

const provider = new ethers.JsonRpcProvider(config.infuraUrl);
const monitoredAddresses = new Set(config.monitoredAddresses.map(addr => addr.toLowerCase()));
const DAI_ADDRESS = config.daiAddress;
const DAI_ABI = [
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "function name() view returns (string)"
];

// Set up the email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: config.email,
        pass: config.emailPassword 
    }
});

async function setupEventListeners(tokenAddress) {
    const contract = new ethers.Contract(tokenAddress, DAI_ABI, provider);

    contract.on('Transfer', async (from, to, value, event) => {
        try {
            const fromAddress = from.toLowerCase();
            const toAddress = to.toLowerCase();
            const address = monitoredAddresses.has(fromAddress) ? fromAddress : toAddress;

            if (monitoredAddresses.has(fromAddress) || monitoredAddresses.has(toAddress)) {
                const formattedValue = ethers.formatUnits(value, 18); // DAI has 18 decimals

                // Fetch the block to get its timestamp
                const block = await provider.getBlock(event.blockNumber);
                const timestamp = new Date(block.timestamp * 1000).toISOString(); // Convert Unix timestamp to ISO string

                // Prepare notification data
                const notificationData = {
                    token: await contract.name(),
                    address,
                    action: monitoredAddresses.has(fromAddress) ? 'sent' : 'received',
                    amount: formattedValue,
                    transactionHash: event.transactionHash,
                    blockNumber: event.blockNumber,
                    timestamp, // Use the fetched timestamp
                };

                // Send email notification
                await sendEmailNotification(notificationData);
            }
        } catch (error) {
            console.error(`Error processing transfer event:`, error);
        }
    });
}


async function sendEmailNotification(data) {
    const mailOptions = {
        from: config.email, 
        to: 'aryashubham2312@gmail.com', 
        subject: `Transfer Notification: ${data.token}`,
        text: `
            Transfer Details:
            Token: ${data.token}
            Address: ${data.address}
            Action: ${data.action}
            Amount: ${data.amount}
            Transaction Hash: ${data.transactionHash}
            Block Number: ${data.blockNumber}
            Timestamp: ${data.timestamp}
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email notification sent for ${data.token} transfer involving address ${data.address}`);
    } catch (error) {
        console.error(`Failed to send email notification:`, error);
    }
}

async function monitorToken(tokenAddress) {
    let retries = 0;
    while (retries < MAX_RETRIES) {
        try {
            await setupEventListeners(tokenAddress);
            console.log(`Successfully set up event listener for token at ${tokenAddress}`);
            return;
        } catch (error) {
            console.error(`Failed to set up event listener for token at ${tokenAddress}:`, error);
            retries++;
            if (retries >= MAX_RETRIES) throw error;
            await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60 seconds before retrying
        }
    }
}

async function main() {
    try {
        await monitorToken(DAI_ADDRESS);
        console.log(`Monitoring DAI transfers for specified addresses...`);
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

main();
