/**
 * Barespace — Document View Tracker & Signing (test script)
 *
 * Deploy as a Web App (Execute as: Me, Access: Anyone).
 * Tracking link format:
 *   https://script.google.com/.../exec?docId=YOUR_DOC_ID&dealId=YOUR_DEAL_ID
 *
 * SCRIPT PROPERTIES (Project Settings → Script Properties):
 *   HUBSPOT_PRIVATE_APP_TOKEN  ← HubSpot private app token
 *
 * Flow:
 *   1. Client opens tracking link → email to NOTIFY_EMAIL + landing page
 *   2. Client clicks "Sign Contract" → signing form
 *   3. Client submits → PDF emailed to NOTIFY_EMAIL + attached as note
 *      on HubSpot Deal, Contact, and Company
 */

var NOTIFY_EMAIL = 'kevin@barespace.io';

// ─── Routing ──────────────────────────────────────────────────────────────────

function doGet(e) {
  var p      = e.parameter || {};
  var docId  = p.docId  || '';
  var dealId = p.dealId || '';
  var docUrl = docId
    ? 'https://docs.google.com/document/d/' + docId + '/preview'
    : 'https://docs.google.com';

  if (p.action === 'sign') {
    return HtmlService.createHtmlOutput(buildSigningPage(docId, dealId, docUrl))
      .setTitle('Sign Your Barespace Contract')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Default: send "viewed" notification then show landing page
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'Contract Viewed',
    'Your Barespace contract was just opened.\n\nDocument: ' + docUrl
  );

  return HtmlService.createHtmlOutput(buildLandingPage(docId, dealId, docUrl))
    .setTitle('Barespace Contract')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── Called from signing page via google.script.run ──────────────────────────

function submitSignature(data) {
  var docId     = data.docId;
  var dealId    = data.dealId;
  var typedName = data.typedName;
  var docUrl    = 'https://docs.google.com/document/d/' + docId + '/preview';
  var signedAt  = new Date().toLocaleString('en-IE', { timeZone: 'Europe/Dublin' });

  // Export Google Doc as PDF
  var pdfBlob = DriveApp.getFileById(docId).getAs('application/pdf');
  pdfBlob.setName('Barespace_Contract_Signed.pdf');

  // Email notification with PDF attached
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'Contract Signed',
    'The Barespace contract has been signed.\n\n' +
    'Signed by: ' + typedName + '\n' +
    'Signed at: ' + signedAt + '\n\n' +
    'Document: ' + docUrl,
    { attachments: [pdfBlob] }
  );

  // Attach to HubSpot if a Deal ID was provided
  if (dealId) {
    attachToHubspot(pdfBlob, dealId, typedName, signedAt);
  }

  return { success: true };
}

// ─── HubSpot attachment ───────────────────────────────────────────────────────

// HubSpot CRM Notes v3 association type IDs
var HS_ASSOC = {
  NOTE_TO_CONTACT: 202,
  NOTE_TO_COMPANY: 190,
  NOTE_TO_DEAL:    214,
};

function attachToHubspot(pdfBlob, dealId, typedName, signedAt) {
  var token = PropertiesService.getScriptProperties().getProperty('HUBSPOT_PRIVATE_APP_TOKEN');
  if (!token) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN not set in Script Properties');

  var headers    = { 'Authorization': 'Bearer ' + token };
  var jsonHeaders = Object.assign({}, headers, { 'Content-Type': 'application/json' });

  // Get associated contacts and companies from the deal
  var contactIds = getAssociatedIds(dealId, 'contacts', token);
  var companyIds = getAssociatedIds(dealId, 'companies', token);
  Logger.log('Deal: ' + dealId + ' | Contacts: ' + contactIds + ' | Companies: ' + companyIds);

  // Upload PDF to HubSpot Files API
  var uploadResp = UrlFetchApp.fetch('https://api.hubapi.com/files/v3/files', {
    method:  'post',
    headers: headers,
    payload: {
      file:       pdfBlob,
      folderPath: '/contracts',
      options:    JSON.stringify({ access: 'PRIVATE', overwrite: false }),
    },
    muteHttpExceptions: true,
  });

  var fileData  = JSON.parse(uploadResp.getContentText());
  Logger.log('HubSpot file upload response: ' + JSON.stringify(fileData));

  if (!fileData.id) throw new Error('File upload failed: ' + JSON.stringify(fileData));

  var hubFileId = fileData.id;

  // Build associations array for the note — deal + all contacts + all companies
  var associations = [];

  associations.push({
    to:    { id: dealId },
    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HS_ASSOC.NOTE_TO_DEAL }],
  });

  contactIds.forEach(function(id) {
    associations.push({
      to:    { id: id },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HS_ASSOC.NOTE_TO_CONTACT }],
    });
  });

  companyIds.forEach(function(id) {
    associations.push({
      to:    { id: id },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HS_ASSOC.NOTE_TO_COMPANY }],
    });
  });

  // Create note with hs_attachment_ids — appears in the Attachments section of each record
  var notePayload = {
    properties: {
      hs_note_body:       'Signed Barespace Contract — ' + typedName + ' — ' + signedAt,
      hs_timestamp:       new Date().toISOString(),
      hs_attachment_ids:  String(hubFileId),
    },
    associations: associations,
  };

  var noteResp = UrlFetchApp.fetch('https://api.hubapi.com/crm/v3/objects/notes', {
    method:             'post',
    headers:            jsonHeaders,
    payload:            JSON.stringify(notePayload),
    muteHttpExceptions: true,
  });

  Logger.log('HubSpot note response (' + noteResp.getResponseCode() + '): ' + noteResp.getContentText());
}

function getAssociatedIds(dealId, objectType, token) {
  try {
    var resp = UrlFetchApp.fetch(
      'https://api.hubapi.com/crm/v4/objects/deals/' + dealId + '/associations/' + objectType,
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    var data = JSON.parse(resp.getContentText());
    return (data.results || []).map(function(r) { return r.toObjectId; });
  } catch (e) {
    Logger.log('Failed to get ' + objectType + ': ' + e);
    return [];
  }
}

// ─── HTML: Landing page ───────────────────────────────────────────────────────

function buildLandingPage(docId, dealId, docUrl) {
  var baseUrl = ScriptApp.getService().getUrl();
  var signUrl = baseUrl + '?action=sign&docId=' + encodeURIComponent(docId) + '&dealId=' + encodeURIComponent(dealId);

  return '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' +
      'body{font-family:"Helvetica Neue",Arial,sans-serif;background:#f4f6f4;margin:0;padding:40px 16px}' +
      '.card{background:#fff;max-width:460px;margin:0 auto;padding:44px 36px;border-radius:12px;box-shadow:0 2px 18px rgba(0,0,0,.09)}' +
      '.logo{font-size:20px;font-weight:700;color:#07756C;letter-spacing:.04em;margin-bottom:28px}' +
      'h1{font-size:19px;color:#111;margin:0 0 10px}' +
      'p{color:#555;font-size:15px;line-height:1.6;margin:0 0 28px}' +
      '.btn{display:block;width:100%;padding:14px;border-radius:8px;font-size:15px;font-weight:600;text-align:center;text-decoration:none;box-sizing:border-box;margin-bottom:12px}' +
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

function buildSigningPage(docId, dealId, docUrl) {
  return '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
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
      '.agree input{margin-top:3px;flex-shrink:0}' +
      '.agree span{font-size:14px;color:#555;line-height:1.6}' +
      '.btn{width:100%;padding:14px;background:#07756C;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}' +
      '.btn:disabled{background:#ccc;cursor:not-allowed}' +
      '.success{text-align:center;padding:16px 0}' +
      '.success h2{color:#07756C}' +
    '</style></head><body>' +
    '<div class="card">' +
      '<div class="logo">BARESPACE</div>' +
      '<div id="form-section">' +
        '<h1>Sign Your Contract</h1>' +
        '<p>By typing your full name and checking the box below you are electronically signing and agreeing to the terms of your Barespace Subscription Agreement.</p>' +
        '<label for="typedName">Full Name</label>' +
        '<input type="text" id="typedName" placeholder="Your full name" autocomplete="name">' +
        '<div class="agree">' +
          '<input type="checkbox" id="agree">' +
          '<span>I have read and agree to the terms of the Barespace Subscription Agreement.</span>' +
        '</div>' +
        '<button class="btn" id="submitBtn" onclick="submit_()" disabled>Sign Contract</button>' +
      '</div>' +
      '<div id="success-section" class="success" style="display:none">' +
        '<h2>Contract Signed</h2>' +
        '<p>Thank you. Your signature has been recorded and a copy will be sent to you by your Barespace representative.</p>' +
      '</div>' +
    '</div>' +
    '<script>' +
      'var agree=document.getElementById("agree");' +
      'var nameInput=document.getElementById("typedName");' +
      'var btn=document.getElementById("submitBtn");' +
      'function checkReady(){btn.disabled=!(agree.checked&&nameInput.value.trim().length>1);}' +
      'agree.addEventListener("change",checkReady);' +
      'nameInput.addEventListener("input",checkReady);' +
      'function submit_(){' +
        'btn.disabled=true;btn.textContent="Submitting\u2026";' +
        'google.script.run' +
          '.withSuccessHandler(function(){' +
            'document.getElementById("form-section").style.display="none";' +
            'document.getElementById("success-section").style.display="block";' +
          '})' +
          '.withFailureHandler(function(err){' +
            'btn.disabled=false;btn.textContent="Sign Contract";' +
            'alert("Something went wrong: "+(err.message||err));' +
          '})' +
          '.submitSignature({typedName:nameInput.value.trim(),docId:"' + docId + '",dealId:"' + dealId + '"});' +
      '}' +
    '</script>' +
    '</body></html>';
}
