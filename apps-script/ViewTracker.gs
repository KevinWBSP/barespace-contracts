/**
 * Barespace — Document View Tracker & Signing (test script)
 *
 * Deploy as a Web App (Execute as: Me, Access: Anyone).
 * Tracking link format:
 *   https://script.google.com/.../exec?docId=YOUR_DOC_ID
 *
 * Flow:
 *   1. Client opens tracking link → email to NOTIFY_EMAIL + landing page
 *   2. Client clicks "Sign Contract" → signing form
 *   3. Client submits → email to NOTIFY_EMAIL with signed PDF attached
 */

var NOTIFY_EMAIL = 'kevin@barespace.io';

// ─── Routing ──────────────────────────────────────────────────────────────────

function doGet(e) {
  var p     = e.parameter || {};
  var docId = p.docId || '';
  var docUrl = docId
    ? 'https://docs.google.com/document/d/' + docId + '/preview'
    : 'https://docs.google.com';

  if (p.action === 'sign') {
    return HtmlService.createHtmlOutput(buildSigningPage(docId, docUrl))
      .setTitle('Sign Your Barespace Contract')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Default: send "viewed" notification then show landing page
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'Contract Viewed',
    'Your Barespace contract was just opened.\n\nDocument: ' + docUrl
  );

  return HtmlService.createHtmlOutput(buildLandingPage(docId, docUrl))
    .setTitle('Barespace Contract')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── Called from signing page via google.script.run ──────────────────────────

function submitSignature(data) {
  var docId     = data.docId;
  var typedName = data.typedName;
  var docUrl    = 'https://docs.google.com/document/d/' + docId + '/preview';

  // Export Google Doc as PDF
  var pdfBlob = DriveApp.getFileById(docId).getAs('application/pdf');
  pdfBlob.setName('Barespace_Contract_Signed.pdf');

  // Email with PDF attached
  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'Contract Signed',
    'The Barespace contract has been signed.\n\nSigned by: ' + typedName + '\nSigned at: ' + new Date().toLocaleString('en-IE', { timeZone: 'Europe/Dublin' }) + '\n\nDocument: ' + docUrl,
    { attachments: [pdfBlob] }
  );

  return { success: true };
}

// ─── HTML: Landing page ───────────────────────────────────────────────────────

function buildLandingPage(docId, docUrl) {
  var baseUrl  = ScriptApp.getService().getUrl();
  var signUrl  = baseUrl + '?action=sign&docId=' + encodeURIComponent(docId);

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

function buildSigningPage(docId, docUrl) {
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
          '.withFailureHandler(function(){' +
            'btn.disabled=false;btn.textContent="Sign Contract";' +
            'alert("Something went wrong. Please try again.");' +
          '})' +
          '.submitSignature({typedName:nameInput.value.trim(),docId:"' + docId + '"});' +
      '}' +
    '</script>' +
    '</body></html>';
}
