const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR);
app.use('/screenshots', express.static(SCREENSHOTS_DIR));

const delay = (min, max) => new Promise(r =>
  setTimeout(r, Math.floor(Math.random() * (max - min) + min))
);

async function humanType(page, selector, text) {
  const el = page.locator(selector).first();
  await el.click();
  await delay(300, 600);
  for (const char of text) {
    await page.keyboard.type(char);
    await delay(80, 220);
  }
}

function getBaseUrl() {
  return process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${process.env.PORT || 3000}`;
}

// ─── CORE FORM FILLER ───────────────────────────────────────────────────────
async function fillForm(page, data) {

  // STEP 1: Open the service page
  await page.goto('https://services.bahrain.bh/wps/portal/IdentityCardServices_en', {
    waitUntil: 'networkidle', timeout: 60000
  });
  await delay(2000, 3000);

  // STEP 2: Click Appointments Booking and Enquiry
  await page.locator('text=Appointments Booking and Enquiry').first().click();
  await page.waitForLoadState('networkidle');
  await delay(2000, 3500);

  // STEP 3: Close announcement banner if it appears
  try {
    const closeBtn = page.locator('button:has-text("Close"), button:has-text("close"), .close, [aria-label="Close"]').first();
    if (await closeBtn.isVisible({ timeout: 3000 })) {
      await closeBtn.click();
      await delay(1000, 1500);
      console.log('Closed banner popup');
    }
  } catch (e) {
    console.log('No banner popup found, continuing');
  }

  // STEP 4: Select "Book a new Appointment"
  await page.locator('label:has-text("Book a new Appointment")').first().click();
  await delay(1500, 2500);

  // STEP 5: Select Applicant type from dropdown
  const isDependent = data.cpr_type === 'DEPENDENT';
  const applicantLabel = isDependent
    ? 'Non-Bahraini Dependents'
    : 'Non-Bahraini (Registered in LMRA)';

  await page.locator('select').filter({ hasText: 'Select Applicant' }).selectOption({ label: new RegExp(applicantLabel.substring(0, 25), 'i') });
  await delay(2000, 3500);

  // STEP 6: Select Request Type (critical diverging step)
  const isRenewal = data.cpr_type === 'RENEWAL';
  if (isRenewal) {
    await page.locator('label:has-text("Renew"), label:has-text("Replace")').first().click();
    console.log('Selected: Renewal/Replace');
  } else {
    await page.locator('label:has-text("Identity Card Issuance")').first().click();
    console.log('Selected: Identity Card Issuance');
  }
  await delay(1500, 2500);

  // STEP 7: Select Branch - Isa Town NonBahraini
  await page.locator('select').filter({ hasText: /Branch|Select/ }).last()
    .selectOption({ label: /Isa Town.*NonBahraini|Isa Town.*Non.*Bahraini/i });
  await delay(2000, 3500);

  // STEP 8: Click Search
  await page.locator('input[value="Search"], button:has-text("Search")').first().click();
  await page.waitForLoadState('networkidle');
  await delay(2000, 4000);

  // STEP 9: Select Appointment Date (next available)
  const dateSelect = page.locator('select[name*="Date"], select[id*="date"]').first();
  const dateOptions = await dateSelect.locator('option').all();
  let selectedDate = '';
  for (const opt of dateOptions) {
    const val = await opt.getAttribute('value');
    const text = await opt.textContent();
    if (val && val !== '' && val !== '0') {
      await dateSelect.selectOption({ value: val });
      selectedDate = text.trim();
      console.log('Selected date:', selectedDate);
      break;
    }
  }
  await delay(2000, 3500);

  // STEP 10: Select Appointment Time - first slot after 9:30 AM
  let selectedTime = '';
  const timeSelect = page.locator('select[name*="Time"], select[id*="time"]').first();
  const timeOptions = await timeSelect.locator('option').all();
  for (const opt of timeOptions) {
    const text = await opt.textContent();
    const match = text.match(/(\d+):(\d+)/);
    if (match) {
      const h = parseInt(match[1]), m = parseInt(match[2]);
      if (h > 9 || (h === 9 && m >= 30)) {
        const val = await opt.getAttribute('value');
        await timeSelect.selectOption({ value: val });
        selectedTime = text.trim();
        console.log('Selected time:', selectedTime);
        break;
      }
    }
  }
  await delay(1500, 2500);

  // STEP 11: Enter Unit / Commercial Registration Number
  await humanType(page,
    'input[name*="Unit"], input[id*="Unit"], input[name*="Commercial"]',
    data.cr_number
  );
  await delay(1500, 2500);

  // STEP 12: Enter Clearing Agent Personal Number (PRO Number)
  await humanType(page,
    'input[name*="Clearing"], input[id*="Clearing"], input[name*="Agent"]',
    data.pro_number
  );
  await delay(1500, 2500);

  // STEP 13: Enter Mobile Number
  await humanType(page,
    'input[name*="Mobile"], input[id*="Mobile"]',
    data.mobile
  );
  await delay(1000, 2000);

  // STEP 14: Enter Email
  await humanType(page,
    'input[name*="Email"], input[id*="Email"], input[type="email"]',
    data.email
  );
  await delay(1000, 2000);

  // STEP 15: Click the blue Add button
  await page.locator('input[value="Add"], button:has-text("Add")').first().click();
  await delay(2000, 3500);

  // STEP 16: Individual Details section appears - add CPR numbers
  // Handle multiple CPR numbers (array or single)
  const cprNumbers = Array.isArray(data.cpr_number)
    ? data.cpr_number
    : [data.cpr_number];

  for (let i = 0; i < cprNumbers.length; i++) {
    const cpn = cprNumbers[i];
    console.log(`Adding CPR ${i + 1}/${cprNumbers.length}: ${cpn}`);

    // Enter CPR number in Individual Details text field
    await humanType(page,
      'input[name*="Personal"], input[id*="personal"], input[placeholder*="Personal"]',
      cpn
    );
    await delay(1000, 1500);

    // Click green + button to add to queue
    await page.locator('.green-plus, button:has-text("+"), input[value="+"], a[href*="add"], td:has-text("+")').first().click();
    await delay(2000, 3000);
    console.log(`CPR ${cpn} added to queue`);
  }

  return { selectedDate, selectedTime };
}

// ─── PHASE 1: Fill form → screenshot for human review ───────────────────────
app.post('/phase1', async (req, res) => {
  const data = req.body;
  console.log('=== PHASE 1 START ===', data.client_name, data.cpr_type);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  try {
    const { selectedDate, selectedTime } = await fillForm(page, data);

    // Screenshot BEFORE Save Appointment - for human review
    const filename = `review_${Date.now()}_${data.cpr_number}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, filename), fullPage: true });
    console.log('Phase 1 screenshot taken:', filename);

    await browser.close();

    res.json({
      status: 'AWAITING_REVIEW',
      appointment_date: selectedDate,
      appointment_time: selectedTime,
      screenshot_url: `${getBaseUrl()}/screenshots/${filename}`,
      client_name: data.client_name,
      cpr_number: data.cpr_number
    });

  } catch (error) {
    console.error('Phase 1 failed:', error.message);
    const filename = `error_phase1_${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, filename), fullPage: true }).catch(() => {});
    await browser.close();
    res.status(500).json({ status: 'FAILED', error: error.message, screenshot_url: `${getBaseUrl()}/screenshots/${filename}` });
  }
});

// ─── PHASE 2: Re-fill → Save Appointment → Confirm → final screenshot ────────
app.post('/phase2', async (req, res) => {
  const data = req.body;
  console.log('=== PHASE 2 START ===', data.client_name);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();

  try {
    const { selectedDate, selectedTime } = await fillForm(page, data);

    // CONFIRM STEP: Click Save Appointment
    await page.locator('input[value="Save Appointment"], button:has-text("Save Appointment")').first().click();
    await page.waitForLoadState('networkidle');
    await delay(3000, 5000);
    console.log('Clicked Save Appointment');

    // Handle confirmation prompt if it appears
    const confirmBtn = page.locator('button:has-text("Confirm"), input[value="Confirm"], a:has-text("Confirm")').first();
    if (await confirmBtn.isVisible({ timeout: 5000 })) {
      await confirmBtn.click();
      await page.waitForLoadState('networkidle');
      await delay(3000, 5000);
      console.log('Clicked Confirm button');
    }

    // Extract confirmed date from confirmation page
    const pageText = await page.textContent('body');
    const dateMatch = pageText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
    const confirmedDate = dateMatch ? dateMatch[1] : selectedDate;

    // Final confirmation screenshot
    const filename = `confirmed_${Date.now()}_${data.cpr_number}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, filename), fullPage: true });
    console.log('Phase 2 confirmation screenshot:', filename);

    await browser.close();

    res.json({
      status: 'BOOKED',
      appointment_date: confirmedDate,
      appointment_time: selectedTime,
      screenshot_url: `${getBaseUrl()}/screenshots/${filename}`,
      client_name: data.client_name
    });

  } catch (error) {
    console.error('Phase 2 failed:', error.message);
    const filename = `error_phase2_${Date.now()}.png`;
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, filename), fullPage: true }).catch(() => {});
    await browser.close();
    res.status(500).json({ status: 'FAILED', error: error.message, screenshot_url: `${getBaseUrl()}/screenshots/${filename}` });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CPR Playwright server on port ${PORT}`));
