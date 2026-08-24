/**
 * Barespace — Document View Tracker (test script)
 *
 * Deploy as a Web App (Execute as: Me, Access: Anyone).
 * Use the deployed URL as your tracking link, with the Google Doc ID appended:
 *   https://script.google.com/.../exec?docId=YOUR_DOC_ID
 *
 * When the link is opened:
 *   1. Sends an email to kevin@barespace.io
 *   2. Redirects the visitor to the Google Doc
 */

var NOTIFY_EMAIL = 'kevin@barespace.io';

function doGet(e) {
  var docId = (e.parameter && e.parameter.docId) ? e.parameter.docId : '';
  var docUrl = docId
    ? 'https://docs.google.com/document/d/' + docId + '/preview'
    : 'https://docs.google.com';

  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'Contract Viewed',
    'Your Barespace contract was just opened.\n\nDocument: ' + docUrl
  );

  return HtmlService.createHtmlOutput(
    '<html><head><meta http-equiv="refresh" content="0;url=' + docUrl + '"></head>' +
    '<body>Opening your contract...</body></html>'
  );
}
