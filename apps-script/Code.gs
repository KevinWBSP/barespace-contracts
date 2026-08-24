/**
 * Barespace Contract — Apps Script Web App
 *
 * Deployed as a Web App (Execute as: Me, Access: Anyone).
 * Handles contract tracking, signing, PDF export, and HubSpot attachment.
 *
 * SCRIPT PROPERTIES (set via Project Settings → Script Properties):
 *   HUBSPOT_PRIVATE_APP_TOKEN   ← HubSpot private app token
 *   GOOGLE_DRIVE_FOLDER_ID      ← ID of the "Barespace Contracts" Drive folder
 *
 * ONE-TIME SETUP:
 *   Run setup() once after deploying to create the Drive folder automatically.
 *   Then copy GOOGLE_DRIVE_FOLDER_ID into both HubSpot secrets and Script Properties.
 */

// ─── Routing ──────────────────────────────────────────────────────────────────

function doGet(e) {
  const p = e.parameter || {};

  if (!p.docId) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">Invalid link.</p>');
  }

  if (p.action === 'sign') {
    return HtmlService.createHtmlOutput(buildSigningPage(p))
      .setTitle('Sign Your Barespace Contract')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Default: landing page — fires "viewed" notification on open
  sendNotification(
    p.ownerEmail,
    'Contract Viewed \u2014 ' + p.companyName,
    p.contactName + ' has opened the Barespace contract for ' + p.companyName + '.\n\n' +
    'View document: https://docs.google.com/document/d/' + p.docId + '/preview'
  );

  return HtmlService.createHtmlOutput(buildLandingPage(p))
    .setTitle('Barespace Contract')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── Called from client-side via google.script.run ────────────────────────────

function submitSignature(data) {
  const { typedName, docId, dealId, ownerEmail, contactName, companyName } = data;

  const now = new Date();
  const signedAt = now.toLocaleString('en-IE', { timeZone: 'Europe/Dublin' });

  // Export Google Doc as PDF
  const docFile = DriveApp.getFileById(docId);
  const pdfBlob = docFile.getAs('application/pdf');
  const safeName = (companyName || contactName).replace(/[^a-zA-Z0-9]/g, '_');
  pdfBlob.setName('Barespace_Contract_' + safeName + '_Signed.pdf');

  // Save signed PDF to Barespace Contracts folder
  const folderId = PropertiesService.getScriptProperties().getProperty('GOOGLE_DRIVE_FOLDER_ID');
  const folder   = DriveApp.getFolderById(folderId);
  const savedPdf = folder.createFile(pdfBlob);
  const pdfUrl   = savedPdf.getUrl();

  // Attach to HubSpot records
  if (dealId) {
    attachToHubspot(savedPdf.getId(), pdfBlob, dealId, contactName, companyName, signedAt, pdfUrl);
  }

  // Notify salesperson
  sendNotification(
    ownerEmail,
    'Contract Signed \u2014 ' + companyName,
    contactName + ' has signed the Barespace contract for ' + companyName + '.\n\n' +
    'Signed as: ' + typedName + '\n' +
    'Signed at: ' + signedAt + '\n\n' +
    'Signed PDF (Google Drive): ' + pdfUrl
  );

  return { success: true };
}

// ─── HubSpot attachment ───────────────────────────────────────────────────────

function attachToHubspot(pdfFileId, pdfBlob, dealId, contactName, companyName, signedAt, pdfUrl) {
  const token   = PropertiesService.getScriptProperties().getProperty('HUBSPOT_PRIVATE_APP_TOKEN');
  const headers = { 'Authorization': 'Bearer ' + token };

  // Get associated contacts and companies from the deal
  const contactIds = getAssociatedIds(dealId, 'contacts', token);
  const companyIds = getAssociatedIds(dealId, 'companies', token);

  // Upload PDF to HubSpot Files API
  const uploadResp = UrlFetchApp.fetch('https://api.hubapi.com/files/v3/files', {
    method:           'post',
    headers:          headers,
    payload: {
      file:       pdfBlob,
      folderPath: '/contracts',
      options:    JSON.stringify({ access: 'PRIVATE', overwrite: false }),
    },
    muteHttpExceptions: true,
  });

  const fileData  = JSON.parse(uploadResp.getContentText());
  const hubFileId = fileData.id;
  const hubFileUrl = fileData.url || pdfUrl;

  // Create a Note engagement associated with deal + contacts + companies
  const noteBody =
    '<p><strong>Signed Barespace Contract</strong></p>' +
    '<p>Signed by: ' + escapeHtml(contactName) + '<br>' +
    'Company: ' + escapeHtml(companyName) + '<br>' +
    'Signed at: ' + escapeHtml(signedAt) + '</p>' +
    '<p><a href="' + hubFileUrl + '">Download Signed PDF</a></p>';

  const engagement = {
    engagement:   { active: true, type: 'NOTE', timestamp: Date.now() },
    associations: {
      dealIds:    [parseInt(dealId)],
      contactIds: contactIds.map(Number),
      companyIds: companyIds.map(Number),
    },
    attachments: hubFileId ? [{ id: hubFileId }] : [],
    metadata:    { body: noteBody },
  };

  UrlFetchApp.fetch('https://api.hubapi.com/engagements/v1/engagements', {
    method:  'post',
    headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
    payload: JSON.stringify(engagement),
    muteHttpExceptions: true,
  });
}

function getAssociatedIds(dealId, objectType, token) {
  try {
    const resp = UrlFetchApp.fetch(
      'https://api.hubapi.com/crm/v4/objects/deals/' + dealId + '/associations/' + objectType,
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    const data = JSON.parse(resp.getContentText());
    return (data.results || []).map(function(r) { return r.toObjectId; });
  } catch (e) {
    console.log('Failed to get associated ' + objectType + ':', e);
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendNotification(toEmail, subject, body) {
  try {
    if (toEmail) GmailApp.sendEmail(toEmail, subject, body);
  } catch (e) {
    console.log('Email send failed:', e);
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJs(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ─── One-time setup ───────────────────────────────────────────────────────────

function setup() {
  const existing = PropertiesService.getScriptProperties().getProperty('GOOGLE_DRIVE_FOLDER_ID');
  if (existing) {
    Logger.log('Folder already configured: ' + existing);
    return;
  }
  const folder = DriveApp.createFolder('Barespace Contracts');
  PropertiesService.getScriptProperties().setProperty('GOOGLE_DRIVE_FOLDER_ID', folder.getId());
  Logger.log('Created folder. ID: ' + folder.getId());
  Logger.log('Share this folder with your service account, then copy this ID into your HubSpot secrets as GOOGLE_DRIVE_FOLDER_ID.');
}

// ─── HTML: Landing page ───────────────────────────────────────────────────────

function buildLandingPage(p) {
  const docUrl  = 'https://docs.google.com/document/d/' + escapeJs(p.docId) + '/preview';
  const baseUrl = ScriptApp.getService().getUrl();
  const signUrl = baseUrl
    + '?action=sign'
    + '&docId='       + encodeURIComponent(p.docId       || '')
    + '&dealId='      + encodeURIComponent(p.dealId      || '')
    + '&ownerEmail='  + encodeURIComponent(p.ownerEmail  || '')
    + '&contactName=' + encodeURIComponent(p.contactName || '')
    + '&companyName=' + encodeURIComponent(p.companyName || '');

  return '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Barespace Contract</title>' +
    '<style>' +
      'body{font-family:"Helvetica Neue",Arial,sans-serif;background:#f4f6f4;margin:0;padding:40px 16px}' +
      '.card{background:#fff;max-width:460px;margin:0 auto;padding:44px 36px;border-radius:12px;box-shadow:0 2px 18px rgba(0,0,0,.09)}' +
      '.logo{font-size:20px;font-weight:700;color:#07756C;letter-spacing:.04em;margin-bottom:28px}' +
      'h1{font-size:19px;color:#111;margin:0 0 10px}' +
      'p{color:#555;font-size:15px;line-height:1.6;margin:0 0 28px}' +
      '.btn{display:block;width:100%;padding:14px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;text-decoration:none;box-sizing:border-box;margin-bottom:12px;cursor:pointer;border:none}' +
      '.primary{background:#07756C;color:#fff}' +
      '.secondary{background:#f0fdf9;color:#07756C;border:1.5px solid #B2EDD8}' +
    '</style></head><body>' +
    '<div class="card">' +
      '<div class="logo">BARESPACE</div>' +
      '<h1>Your Subscription Agreement</h1>' +
      '<p>Your Barespace contract is ready to review. Please read it in full before signing.</p>' +
      '<a class="btn primary" href="' + docUrl + '" target="_blank">View Contract</a>' +
      '<a class="btn secondary" href="' + signUrl + '">Sign Contract</a>' +
    '</div></body></html>';
}

// ─── HTML: Signing page ───────────────────────────────────────────────────────

function buildSigningPage(p) {
  return '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Sign Your Barespace Contract</title>' +
    '<style>' +
      'body{font-family:"Helvetica Neue",Arial,sans-serif;background:#f4f6f4;margin:0;padding:40px 16px}' +
      '.card{background:#fff;max-width:460px;margin:0 auto;padding:44px 36px;border-radius:12px;box-shadow:0 2px 18px rgba(0,0,0,.09)}' +
      '.logo{font-size:20px;font-weight:700;color:#07756C;letter-spacing:.04em;margin-bottom:28px}' +
      'h1{font-size:19px;color:#111;margin:0 0 10px}' +
      'p{color:#555;font-size:15px;line-height:1.6;margin:0 0 20px}' +
      'label{display:block;font-size:13px;font-weight:600;color:#333;margin-bottom:6px}' +
      'input[type=text]{width:100%;padding:12px;border:1.5px solid #ddd;border-radius:8px;font-size:16px;box-sizing:border-box;margin-bottom:20px}' +
      'input[type=text]:focus{outline:none;border-color:#07756C}' +
      '.agree{display:flex;gap:12px;align-items:flex-start;margin-bottom:28px}' +
      '.agree input{margin-top:3px;flex-shrink:0;width:16px;height:16px}' +
      '.agree span{font-size:14px;color:#555;line-height:1.6}' +
      '.btn{width:100%;padding:14px;background:#07756C;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}' +
      '.btn:disabled{background:#ccc;cursor:not-allowed}' +
      '.success{text-align:center;padding:16px 0}' +
      '.success h2{color:#07756C;margin-bottom:12px}' +
      '.error{color:#c0392b;font-size:14px;margin-top:12px}' +
    '</style></head><body>' +
    '<div class="card">' +
      '<div class="logo">BARESPACE</div>' +
      '<div id="form-section">' +
        '<h1>Sign Your Contract</h1>' +
        '<p>By typing your full name and checking the box below, you are electronically signing and agreeing to the terms of your Barespace Subscription Agreement.</p>' +
        '<label for="typedName">Full Name</label>' +
        '<input type="text" id="typedName" placeholder="' + escapeHtml(p.contactName) + '" autocomplete="name">' +
        '<div class="agree">' +
          '<input type="checkbox" id="agree">' +
          '<span>I have read and agree to the terms of the Barespace Subscription Agreement.</span>' +
        '</div>' +
        '<button class="btn" id="submitBtn" onclick="submit_()" disabled>Sign Contract</button>' +
        '<p class="error" id="errorMsg" style="display:none">Something went wrong. Please try again.</p>' +
      '</div>' +
      '<div id="success-section" class="success" style="display:none">' +
        '<h2>Contract Signed</h2>' +
        '<p>Thank you, ' + escapeHtml(p.contactName) + '. Your signature has been recorded and a copy will be sent to you by your Barespace representative.</p>' +
      '</div>' +
    '</div>' +
    '<script>' +
      'var _d={docId:"' + escapeJs(p.docId) + '",dealId:"' + escapeJs(p.dealId) + '",' +
        'ownerEmail:"' + escapeJs(p.ownerEmail) + '",contactName:"' + escapeJs(p.contactName) + '",' +
        'companyName:"' + escapeJs(p.companyName) + '"};' +
      'var agree=document.getElementById("agree");' +
      'var nameInput=document.getElementById("typedName");' +
      'var btn=document.getElementById("submitBtn");' +
      'function checkReady(){btn.disabled=!(agree.checked&&nameInput.value.trim().length>1);}' +
      'agree.addEventListener("change",checkReady);' +
      'nameInput.addEventListener("input",checkReady);' +
      'function submit_(){' +
        'btn.disabled=true;btn.textContent="Submitting\u2026";' +
        'document.getElementById("errorMsg").style.display="none";' +
        '_d.typedName=nameInput.value.trim();' +
        'google.script.run' +
          '.withSuccessHandler(function(r){' +
            'if(r&&r.success){' +
              'document.getElementById("form-section").style.display="none";' +
              'document.getElementById("success-section").style.display="block";' +
            '}else{' +
              'btn.disabled=false;btn.textContent="Sign Contract";' +
              'document.getElementById("errorMsg").style.display="block";' +
            '}' +
          '})' +
          '.withFailureHandler(function(){' +
            'btn.disabled=false;btn.textContent="Sign Contract";' +
            'document.getElementById("errorMsg").style.display="block";' +
          '})' +
          '.submitSignature(_d);' +
      '}' +
    '</script>' +
    '</body></html>';
}
