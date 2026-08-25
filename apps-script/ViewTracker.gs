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
  var docId            = data.docId;
  var dealId           = data.dealId;
  var printedName      = data.printedName;
  var signatureDataUrl = data.signatureDataUrl;
  var docUrl           = 'https://docs.google.com/document/d/' + docId + '/preview';
  var signedAt         = new Date().toLocaleString('en-IE', { timeZone: 'Europe/Dublin' });

  // Insert drawn signature into the Google Doc then export as PDF
  insertSignatureIntoDoc(docId, signatureDataUrl, printedName, signedAt);
  var pdfBlob = DriveApp.getFileById(docId).getAs('application/pdf');
  pdfBlob.setName('Barespace_Contract_Signed.pdf');

  // Email notification with PDF attached
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'Contract Signed',
    'The Barespace contract has been signed.\n\n' +
    'Signed by: ' + printedName + '\n' +
    'Signed at: ' + signedAt + '\n\n' +
    'Document: ' + docUrl,
    { attachments: [pdfBlob] }
  );

  // Attach to HubSpot if a Deal ID was provided
  if (dealId) {
    attachToHubspot(pdfBlob, dealId, printedName, signedAt);
  }

  return { success: true };
}

// Appends a signature certificate page to the Google Doc before PDF export
function insertSignatureIntoDoc(docId, signatureDataUrl, printedName, signedAt) {
  var doc  = DocumentApp.openById(docId);
  var body = doc.getBody();

  // Decode the base64 PNG captured from the signing canvas
  var base64  = signatureDataUrl.replace('data:image/png;base64,', '');
  var sigBlob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'signature.png');

  // Append a page break then a signature certificate
  body.appendPageBreak();

  var heading = body.appendParagraph('Digital Signature Certificate');
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING2);

  body.appendParagraph('This document was electronically signed under the following conditions:');
  body.appendParagraph('');
  body.appendParagraph('Printed name:  ' + printedName);
  body.appendParagraph('Signed at:         ' + signedAt);
  body.appendParagraph('');
  body.appendParagraph('Signature:');

  var sigImage = body.appendImage(sigBlob);
  sigImage.setWidth(240);
  sigImage.setHeight(90);

  doc.saveAndClose();
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
      '.sig-wrap{position:relative;margin-bottom:8px}' +
      '#sigCanvas{width:100%;height:150px;border:1.5px solid #ddd;border-radius:8px;cursor:crosshair;touch-action:none;background:#fafafa;display:block}' +
      '#sigCanvas.signed{border-color:#07756C}' +
      '.sig-hint{font-size:12px;color:#aaa;margin-bottom:4px}' +
      '.clear-btn{background:none;border:none;color:#07756C;font-size:13px;cursor:pointer;padding:0;margin-bottom:20px;text-decoration:underline}' +
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
        '<p>Print your name, draw your signature in the box, then check the agreement box below.</p>' +
        '<label for="printedName">Print Full Name</label>' +
        '<input type="text" id="printedName" placeholder="Your full name" autocomplete="name">' +
        '<label>Signature</label>' +
        '<p class="sig-hint">Draw your signature below using your mouse or finger</p>' +
        '<div class="sig-wrap">' +
          '<canvas id="sigCanvas"></canvas>' +
        '</div>' +
        '<button class="clear-btn" onclick="clearSig()">Clear signature</button>' +
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
      // Canvas setup
      'var canvas=document.getElementById("sigCanvas");' +
      'var ctx=canvas.getContext("2d");' +
      'var drawing=false,hasSigned=false;' +
      // Scale canvas to actual pixel size
      'function resizeCanvas(){' +
        'var rect=canvas.getBoundingClientRect();' +
        'canvas.width=rect.width*window.devicePixelRatio;' +
        'canvas.height=rect.height*window.devicePixelRatio;' +
        'ctx.scale(window.devicePixelRatio,window.devicePixelRatio);' +
        'ctx.strokeStyle="#111";ctx.lineWidth=2;ctx.lineCap="round";ctx.lineJoin="round";' +
      '}' +
      'resizeCanvas();' +
      // Coordinate helpers
      'function getPos(e){' +
        'var r=canvas.getBoundingClientRect();' +
        'var src=e.touches?e.touches[0]:e;' +
        'return{x:src.clientX-r.left,y:src.clientY-r.top};' +
      '}' +
      // Mouse events
      'canvas.addEventListener("mousedown",function(e){drawing=true;var p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});' +
      'canvas.addEventListener("mousemove",function(e){if(!drawing)return;var p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();markSigned();});' +
      'canvas.addEventListener("mouseup",function(){drawing=false;});' +
      'canvas.addEventListener("mouseleave",function(){drawing=false;});' +
      // Touch events
      'canvas.addEventListener("touchstart",function(e){e.preventDefault();drawing=true;var p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});' +
      'canvas.addEventListener("touchmove",function(e){e.preventDefault();if(!drawing)return;var p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke();markSigned();},{passive:false});' +
      'canvas.addEventListener("touchend",function(){drawing=false;});' +
      'function markSigned(){if(!hasSigned){hasSigned=true;canvas.classList.add("signed");}checkReady();}' +
      'function clearSig(){ctx.clearRect(0,0,canvas.width,canvas.height);hasSigned=false;canvas.classList.remove("signed");checkReady();}' +
      // Form validation
      'var agree=document.getElementById("agree");' +
      'var nameInput=document.getElementById("printedName");' +
      'var btn=document.getElementById("submitBtn");' +
      'function checkReady(){btn.disabled=!(agree.checked&&nameInput.value.trim().length>1&&hasSigned);}' +
      'agree.addEventListener("change",checkReady);' +
      'nameInput.addEventListener("input",checkReady);' +
      // Submit
      'function submit_(){' +
        'btn.disabled=true;btn.textContent="Submitting\u2026";' +
        'var sigDataUrl=canvas.toDataURL("image/png");' +
        'google.script.run' +
          '.withSuccessHandler(function(){' +
            'document.getElementById("form-section").style.display="none";' +
            'document.getElementById("success-section").style.display="block";' +
          '})' +
          '.withFailureHandler(function(err){' +
            'btn.disabled=false;btn.textContent="Sign Contract";' +
            'alert("Something went wrong: "+(err.message||err));' +
          '})' +
          '.submitSignature({printedName:nameInput.value.trim(),signatureDataUrl:sigDataUrl,docId:"' + docId + '",dealId:"' + dealId + '"});' +
      '}' +
    '</script>' +
    '</body></html>';
}
