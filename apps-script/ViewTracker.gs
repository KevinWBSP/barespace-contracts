/**
 * Barespace — Contract Viewer & Signing (test script)
 *
 * Deploy as a Web App (Execute as: Me, Access: Anyone).
 * Tracking link format:
 *   https://script.google.com/.../exec?docId=YOUR_DOC_ID&dealId=YOUR_DEAL_ID
 *
 * SCRIPT PROPERTIES (Project Settings → Script Properties):
 *   HUBSPOT_PRIVATE_APP_TOKEN  ← HubSpot private app token / service key
 *
 * Flow:
 *   1. Client opens tracking link → "viewed" email fires + contract shown embedded
 *   2. Client reads contract, draws signature, checks agreement, submits
 *   3. Signature appended to Google Doc → PDF exported → email to NOTIFY_EMAIL
 *      + PDF attached as note on HubSpot Deal, Contact, and Company
 */

var NOTIFY_EMAIL = 'kevin@barespace.io';

// ─── Routing ──────────────────────────────────────────────────────────────────

function doGet(e) {
  var p      = e.parameter || {};
  var docId  = p.docId  || '';
  var dealId = p.dealId || '';

  if (!docId) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:40px">Invalid link.</p>');
  }

  // Fire "viewed" notification as soon as the page loads
  var docUrl = 'https://docs.google.com/document/d/' + docId + '/preview';
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'Contract Viewed',
    'Your Barespace contract was just opened.\n\nDocument: ' + docUrl
  );

  return HtmlService.createHtmlOutput(buildContractPage(docId, dealId))
    .setTitle('Barespace Subscription Agreement')
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

  var base64  = signatureDataUrl.replace('data:image/png;base64,', '');
  var sigBlob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'signature.png');

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

var HS_ASSOC = {
  NOTE_TO_CONTACT: 202,
  NOTE_TO_COMPANY: 190,
  NOTE_TO_DEAL:    214,
};

function attachToHubspot(pdfBlob, dealId, printedName, signedAt) {
  var token = PropertiesService.getScriptProperties().getProperty('HUBSPOT_PRIVATE_APP_TOKEN');
  if (!token) throw new Error('HUBSPOT_PRIVATE_APP_TOKEN not set in Script Properties');

  var headers     = { 'Authorization': 'Bearer ' + token };
  var jsonHeaders = Object.assign({}, headers, { 'Content-Type': 'application/json' });

  var contactIds = getAssociatedIds(dealId, 'contacts', token);
  var companyIds = getAssociatedIds(dealId, 'companies', token);
  Logger.log('Deal: ' + dealId + ' | Contacts: ' + contactIds + ' | Companies: ' + companyIds);

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

  var fileData = JSON.parse(uploadResp.getContentText());
  Logger.log('HubSpot file upload: ' + JSON.stringify(fileData));
  if (!fileData.id) throw new Error('File upload failed: ' + JSON.stringify(fileData));

  var associations = [];
  associations.push({ to: { id: dealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HS_ASSOC.NOTE_TO_DEAL }] });
  contactIds.forEach(function(id) {
    associations.push({ to: { id: id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HS_ASSOC.NOTE_TO_CONTACT }] });
  });
  companyIds.forEach(function(id) {
    associations.push({ to: { id: id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: HS_ASSOC.NOTE_TO_COMPANY }] });
  });

  var noteResp = UrlFetchApp.fetch('https://api.hubapi.com/crm/v3/objects/notes', {
    method:             'post',
    headers:            jsonHeaders,
    payload:            JSON.stringify({
      properties: {
        hs_note_body:      'Signed Barespace Contract — ' + printedName + ' — ' + signedAt,
        hs_timestamp:      new Date().toISOString(),
        hs_attachment_ids: String(fileData.id),
      },
      associations: associations,
    }),
    muteHttpExceptions: true,
  });

  Logger.log('HubSpot note (' + noteResp.getResponseCode() + '): ' + noteResp.getContentText());
}

function getAssociatedIds(dealId, objectType, token) {
  try {
    var resp = UrlFetchApp.fetch(
      'https://api.hubapi.com/crm/v4/objects/deals/' + dealId + '/associations/' + objectType,
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    return (JSON.parse(resp.getContentText()).results || []).map(function(r) { return r.toObjectId; });
  } catch (e) {
    Logger.log('Failed to get ' + objectType + ': ' + e);
    return [];
  }
}

// ─── HTML: Combined contract view + signing page ──────────────────────────────

function buildContractPage(docId, dealId) {
  var embedUrl = 'https://docs.google.com/document/d/' + docId + '/preview?embedded=true';

  return '<!DOCTYPE html><html><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Barespace Subscription Agreement</title>' +
    '<style>' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'body{font-family:"Helvetica Neue",Arial,sans-serif;background:#f4f6f4;min-height:100vh}' +

      // Header
      '.header{background:#fff;border-bottom:1px solid #e8ebe8;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}' +
      '.logo{font-size:18px;font-weight:700;color:#07756C;letter-spacing:.04em}' +
      '.header-tag{font-size:13px;color:#888}' +

      // Doc embed
      '.doc-wrap{background:#fff;margin:24px auto;max-width:900px;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.07)}' +
      '.doc-wrap iframe{width:100%;height:70vh;border:none;display:block}' +

      // Sign section
      '.sign-wrap{max-width:900px;margin:0 auto 40px;background:#fff;border-radius:12px;padding:36px;box-shadow:0 2px 16px rgba(0,0,0,.07)}' +
      '.sign-wrap h2{font-size:18px;color:#111;margin-bottom:8px}' +
      '.sign-wrap .sub{font-size:14px;color:#777;margin-bottom:28px;line-height:1.5}' +
      '.divider{height:1px;background:#eee;margin:24px 0}' +

      // Form fields
      'label{display:block;font-size:13px;font-weight:600;color:#333;margin-bottom:6px}' +
      'input[type=text]{width:100%;padding:12px;border:1.5px solid #ddd;border-radius:8px;font-size:15px;margin-bottom:24px}' +
      'input[type=text]:focus{outline:none;border-color:#07756C}' +

      // Canvas
      '.sig-label-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}' +
      '.sig-label-row label{margin:0}' +
      '.clear-btn{background:none;border:none;color:#07756C;font-size:13px;cursor:pointer;text-decoration:underline}' +
      '.sig-hint{font-size:12px;color:#aaa;margin-bottom:8px}' +
      '#sigCanvas{width:100%;height:160px;border:1.5px dashed #ccc;border-radius:8px;cursor:crosshair;touch-action:none;background:#fafafa;display:block}' +
      '#sigCanvas.active{border:1.5px solid #07756C;background:#fff}' +

      // Agreement
      '.agree{display:flex;gap:12px;align-items:flex-start;margin:24px 0 28px}' +
      '.agree input{margin-top:2px;flex-shrink:0;width:16px;height:16px;accent-color:#07756C}' +
      '.agree span{font-size:14px;color:#555;line-height:1.6}' +

      // Submit
      '.submit-btn{width:100%;padding:16px;background:#07756C;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;letter-spacing:.01em}' +
      '.submit-btn:disabled{background:#ccc;cursor:not-allowed}' +

      // Success
      '#success{display:none;text-align:center;padding:48px 0}' +
      '#success h2{color:#07756C;font-size:22px;margin-bottom:12px}' +
      '#success p{color:#666;font-size:15px;line-height:1.6}' +
    '</style>' +
    '</head><body>' +

    '<div class="header">' +
      '<span class="logo">BARESPACE</span>' +
      '<span class="header-tag">Subscription Agreement</span>' +
    '</div>' +

    '<div class="doc-wrap">' +
      '<iframe src="' + embedUrl + '" allowfullscreen></iframe>' +
    '</div>' +

    '<div class="sign-wrap">' +
      '<div id="form-section">' +
        '<h2>Sign this Agreement</h2>' +
        '<p class="sub">Scroll through the contract above before signing. By completing the fields below you are electronically signing and agreeing to the terms of your Barespace Subscription Agreement.</p>' +
        '<div class="divider"></div>' +

        '<label for="printedName">Print Full Name</label>' +
        '<input type="text" id="printedName" placeholder="Your full name" autocomplete="name">' +

        '<div class="sig-label-row">' +
          '<label>Draw Signature</label>' +
          '<button class="clear-btn" onclick="clearSig()">Clear</button>' +
        '</div>' +
        '<p class="sig-hint">Use your mouse or finger to sign in the box below</p>' +
        '<canvas id="sigCanvas"></canvas>' +

        '<div class="agree">' +
          '<input type="checkbox" id="agree">' +
          '<span>I confirm I have read this agreement in full and agree to be bound by its terms.</span>' +
        '</div>' +

        '<button class="submit-btn" id="submitBtn" onclick="submit_()" disabled>Sign &amp; Submit</button>' +
      '</div>' +

      '<div id="success">' +
        '<h2>Agreement Signed</h2>' +
        '<p>Thank you. Your signed contract has been recorded.<br>Your Barespace representative will be in touch shortly.</p>' +
      '</div>' +
    '</div>' +

    '<script>' +
      // Canvas setup
      'var canvas=document.getElementById("sigCanvas");' +
      'var ctx=canvas.getContext("2d");' +
      'var drawing=false,hasSigned=false;' +
      'function resizeCanvas(){' +
        'var rect=canvas.getBoundingClientRect();' +
        'var dpr=window.devicePixelRatio||1;' +
        'canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;' +
        'ctx.scale(dpr,dpr);' +
        'ctx.strokeStyle="#111";ctx.lineWidth=2.5;ctx.lineCap="round";ctx.lineJoin="round";' +
      '}' +
      'resizeCanvas();' +
      'window.addEventListener("resize",resizeCanvas);' +
      // Position helper
      'function pos(e){var r=canvas.getBoundingClientRect();var s=e.touches?e.touches[0]:e;return{x:s.clientX-r.left,y:s.clientY-r.top};}' +
      // Mouse
      'canvas.addEventListener("mousedown",function(e){drawing=true;var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});' +
      'canvas.addEventListener("mousemove",function(e){if(!drawing)return;var p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();mark();});' +
      'canvas.addEventListener("mouseup",function(){drawing=false;});' +
      'canvas.addEventListener("mouseleave",function(){drawing=false;});' +
      // Touch
      'canvas.addEventListener("touchstart",function(e){e.preventDefault();drawing=true;var p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});' +
      'canvas.addEventListener("touchmove",function(e){e.preventDefault();if(!drawing)return;var p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();mark();},{passive:false});' +
      'canvas.addEventListener("touchend",function(){drawing=false;});' +
      'function mark(){if(!hasSigned){hasSigned=true;canvas.classList.add("active");}checkReady();}' +
      'function clearSig(){ctx.clearRect(0,0,canvas.width,canvas.height);hasSigned=false;canvas.classList.remove("active");resizeCanvas();checkReady();}' +
      // Validation
      'var agree=document.getElementById("agree");' +
      'var nameInput=document.getElementById("printedName");' +
      'var btn=document.getElementById("submitBtn");' +
      'function checkReady(){btn.disabled=!(agree.checked&&nameInput.value.trim().length>1&&hasSigned);}' +
      'agree.addEventListener("change",checkReady);' +
      'nameInput.addEventListener("input",checkReady);' +
      // Submit
      'function submit_(){' +
        'btn.disabled=true;btn.textContent="Submitting\u2026";' +
        'google.script.run' +
          '.withSuccessHandler(function(){' +
            'document.getElementById("form-section").style.display="none";' +
            'document.getElementById("success").style.display="block";' +
          '})' +
          '.withFailureHandler(function(err){' +
            'btn.disabled=false;btn.textContent="Sign & Submit";' +
            'alert("Something went wrong: "+(err.message||err));' +
          '})' +
          '.submitSignature({' +
            'printedName:nameInput.value.trim(),' +
            'signatureDataUrl:canvas.toDataURL("image/png"),' +
            'docId:"' + docId + '",' +
            'dealId:"' + dealId + '"' +
          '});' +
      '}' +
    '</script>' +
    '</body></html>';
}

// Run this once to grant Google Docs permission, then delete it
function authoriseDocuments() {
  DocumentApp.openById('dummy');
}
