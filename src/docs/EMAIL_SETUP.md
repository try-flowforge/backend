# Email Setup Guide

This guide will help you configure email functionality in your workflow automation system using SMTP.

## Environment Variables

Add the following environment variables to your `.env` file:

```bash
# SMTP Server Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false

# SMTP Authentication
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Email Sender Information
SMTP_FROM_EMAIL=your-email@gmail.com
SMTP_FROM_NAME=FlowForge
```

### Gmail SMTP Provider Setup

Gmail is one of the most popular choices. Follow these steps:

#### Step 1: Enable 2-Step Verification

1. Go to your [Google Account](https://myaccount.google.com/)
2. Navigate to **Security**
3. Under "Signing in to Google," select **2-Step Verification**
4. Follow the setup process if not already enabled

#### Step 2: Create an App Password

1. Go to your [Google Account](https://myaccount.google.com/)
2. Navigate to **Security**
3. Under "Signing in to Google," select **App passwords**
   - If you don't see this option, ensure 2-Step Verification is enabled
4. Select **Mail** as the app and **Other** as the device
5. Enter a custom name like "FlowForge Workflow"
6. Click **Generate**
7. Copy the 16-character password (remove spaces)
8. Use this as your `SMTP_PASS` value
