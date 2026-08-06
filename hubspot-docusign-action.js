/**
 * HubSpot Custom Code Action — Create DocuSign Envelope (Pre-fill approach)
 *
 * No external dependencies — uses only Node.js built-ins (https, crypto, zlib).
 *
 * SECRETS REQUIRED:
 *   DOCUSIGN_INTEGRATION_KEY
 *   DOCUSIGN_USER_ID
 *   DOCUSIGN_RSA_PRIVATE_KEY_PART1   ← first half of key body (no header/footer lines)
 *   DOCUSIGN_RSA_PRIVATE_KEY_PART2   ← second half of key body (no header/footer lines)
 *
 * INPUT PROPERTIES:
 *   dealname, signer_email, signer_full_name, sales_rep_name,
 *   pricing_tier, card_processing_included,
 *   contract_length, payment_frequency,
 *   contract_add_ons_summary, contract_monthly_subscription_display,
 *   contract_pricing_summary, contract_pricing_breakdown_table,
 *   contract_card_rate_disclosure,
 *   contract_manual_email_rate, contract_manual_sms_rate,
 *   contract_setup_fee_display, contract_setup_discount_display,
 *   contract_vat_rate_display, contract_setup_total_due_display,
 *   contract_bae_clause_block, contract_website_clause_block
 *
 * OUTPUT PROPERTIES:
 *   docusign_envelope_id
 *   contract_docusign_url
 */

const https  = require('https');
const crypto = require('crypto');
const zlib   = require('zlib');

const ACCOUNT_ID   = 'd9684d06-3d8e-447f-8097-0dcc4e9a3bf4';
const API_HOST     = 'eu.docusign.net';
const TEMPLATE_URL = 'https://raw.githubusercontent.com/KevinWBSP/' +
  'barespace-contracts/main/Barespace_Subscription_Contract_Template_v2_2.docx';

// ─── CRC32 (required for ZIP) ─────────────────────────────────────────────────

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC32_TABLE[(c ^ buf[i]) & 0xFF];
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ─── ZIP reader ───────────────────────────────────────────────────────────────

function readZip(buf) {
  // Locate End of Central Directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('ZIP EOCD not found');

  const numEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset   = buf.readUInt32LE(eocd + 16);

  const entries = [];
  let pos = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('Bad CD signature at ' + pos);

    const method         = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen        = buf.readUInt16LE(pos + 28);
    const extraLen       = buf.readUInt16LE(pos + 30);
    const commentLen     = buf.readUInt16LE(pos + 32);
    const localOffset    = buf.readUInt32LE(pos + 42);
    const name           = buf.toString('utf8', pos + 46, pos + 46 + nameLen);

    // Local header has its own extra field length — use it to find data start
    const localNameLen  = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart     = localOffset + 30 + localNameLen + localExtraLen;
    const rawData       = buf.slice(dataStart, dataStart + compressedSize);

    let data;
    if      (method === 0) data = rawData;
    else if (method === 8) data = zlib.inflateRawSync(rawData);
    else throw new Error('Unsupported ZIP compression method: ' + method);

    entries.push({ name, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ─── ZIP writer ───────────────────────────────────────────────────────────────

function buildZip(entries) {
  const localParts = [];
  const cdParts    = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf    = Buffer.from(name, 'utf8');
    const isDir      = name.endsWith('/');
    const compressed = (isDir || data.length === 0) ? data : zlib.deflateRawSync(data, { level: 6 });
    const method     = (isDir || data.length === 0) ? 0 : 8;
    const checksum   = crc32(data);

    // Local file header
    const lh = Buffer.alloc(30 + nameBuf.length);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20,              4);
    lh.writeUInt16LE(0,               6);
    lh.writeUInt16LE(method,          8);
    lh.writeUInt16LE(0,              10); // mod time
    lh.writeUInt16LE(0,              12); // mod date
    lh.writeUInt32LE(checksum,       14);
    lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(data.length,    22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0,              28); // extra len
    nameBuf.copy(lh, 30);

    // Central directory entry
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20,              4);
    cd.writeUInt16LE(20,              6);
    cd.writeUInt16LE(0,               8);
    cd.writeUInt16LE(method,         10);
    cd.writeUInt16LE(0,              12); // mod time
    cd.writeUInt16LE(0,              14); // mod date
    cd.writeUInt32LE(checksum,       16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length,    24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0,              30); // extra len
    cd.writeUInt16LE(0,              32); // comment len
    cd.writeUInt16LE(0,              34); // disk start
    cd.writeUInt16LE(0,              36); // internal attrs
    cd.writeUInt32LE(0,              38); // external attrs
    cd.writeUInt32LE(offset,         42); // local header offset
    nameBuf.copy(cd, 46);

    localParts.push(lh, compressed);
    cdParts.push(cd);
    offset += lh.length + compressed.length;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocdBuf = Buffer.alloc(22);
  eocdBuf.writeUInt32LE(0x06054b50, 0);
  eocdBuf.writeUInt16LE(0,                0 + 4);
  eocdBuf.writeUInt16LE(0,                0 + 6);
  eocdBuf.writeUInt16LE(entries.length,   8);
  eocdBuf.writeUInt16LE(entries.length,  10);
  eocdBuf.writeUInt32LE(cdBuf.length,    12);
  eocdBuf.writeUInt32LE(offset,          16);
  eocdBuf.writeUInt16LE(0,              20);

  return Buffer.concat([...localParts, cdBuf, eocdBuf]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function httpsRequest(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
    const h = { ...headers };
    if (payload) h['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request({ method, hostname, path, headers: h }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function base64url(s) {
  return Buffer.from(s).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
  const USER_ID         = process.env.DOCUSIGN_USER_ID;
  const PRIVATE_KEY     = '-----BEGIN RSA PRIVATE KEY-----\n'
    + process.env.DOCUSIGN_RSA_PRIVATE_KEY_PART1
    + process.env.DOCUSIGN_RSA_PRIVATE_KEY_PART2
    + '\n-----END RSA PRIVATE KEY-----';

  const now = Math.floor(Date.now() / 1000);
  const h   = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c   = base64url(JSON.stringify({
    iss: INTEGRATION_KEY, sub: USER_ID,
    aud: 'account.docusign.com', scope: 'signature',
    iat: now, exp: now + 3600,
  }));
  const u = h + '.' + c;
  const s = crypto.createSign('RSA-SHA256').update(u).sign(PRIVATE_KEY, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const resp = await httpsRequest(
    'POST', 'account.docusign.com', '/oauth/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + u + '.' + s
  );
  if (!resp.body.access_token) throw new Error('DocuSign auth failed: ' + JSON.stringify(resp.body));
  return resp.body.access_token.trim();
}

// Escapes plain text for safe insertion into Word XML; converts \n to Word line breaks.
function toXmlText(str) {
  if (!str) return '';
  return str
    .split('\n')
    .map(part => part
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'))
    .join('</w:t><w:br/><w:t xml:space="preserve">');
}

// ─── DOCX pre-fill ────────────────────────────────────────────────────────────

function prefillDocx(buffer, values) {
  const entries  = readZip(buffer);
  const docEntry = entries.find(e => e.name === 'word/document.xml');
  if (!docEntry) throw new Error('word/document.xml not found in DOCX');

  let xml = docEntry.data.toString('utf8');

  // Remove add-on sections entirely when their clause block is not provided
  const addonSections = [
    {
      key:     'contract_bae_clause_block',
      heading: '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:color="B2EDD8" w:sz="8"/></w:pBdr><w:spacing w:after="180" w:before="260"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Special Gothic Expanded" w:cs="Special Gothic Expanded" w:eastAsia="Special Gothic Expanded" w:hAnsi="Special Gothic Expanded"/><w:b/><w:bCs/><w:color w:val="07756C"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">Barespace Automated Marketing (BAE) Package</w:t></w:r></w:p>',
      clause:  '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:color="B2EDD8" w:sz="4"/><w:bottom w:val="single" w:color="B2EDD8" w:sz="4"/><w:left w:val="single" w:color="B2EDD8" w:sz="4"/><w:right w:val="single" w:color="B2EDD8" w:sz="4"/></w:pBdr><w:shd w:fill="FFF0FF" w:val="clear"/><w:spacing w:after="300"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Merriweather" w:cs="Merriweather" w:eastAsia="Merriweather" w:hAnsi="Merriweather"/><w:i/><w:iCs/><w:color w:val="555B63"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">[[contract_bae_clause_block]]</w:t></w:r></w:p>',
    },
    {
      key:     'contract_website_clause_block',
      heading: '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:color="B2EDD8" w:sz="8"/></w:pBdr><w:spacing w:after="180" w:before="260"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Special Gothic Expanded" w:cs="Special Gothic Expanded" w:eastAsia="Special Gothic Expanded" w:hAnsi="Special Gothic Expanded"/><w:b/><w:bCs/><w:color w:val="07756C"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">Barespace Website Package</w:t></w:r></w:p>',
      clause:  '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:color="B2EDD8" w:sz="4"/><w:bottom w:val="single" w:color="B2EDD8" w:sz="4"/><w:left w:val="single" w:color="B2EDD8" w:sz="4"/><w:right w:val="single" w:color="B2EDD8" w:sz="4"/></w:pBdr><w:shd w:fill="FFF0FF" w:val="clear"/><w:spacing w:after="300"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Merriweather" w:cs="Merriweather" w:eastAsia="Merriweather" w:hAnsi="Merriweather"/><w:i/><w:iCs/><w:color w:val="555B63"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">[[contract_website_clause_block]]</w:t></w:r></w:p>',
    },
  ];
  for (const { key, heading, clause } of addonSections) {
    if (!values[key]) xml = xml.split(heading + clause).join('');
  }

  // Replace [[field_name]] placeholders
  for (const [key, val] of Object.entries(values)) {
    xml = xml.split(`[[${key}]]`).join(toXmlText(val || ''));
  }

  // Remove pink placeholder backgrounds (keep teal/green table shading)
  xml = xml.split('<w:shd w:fill="FFF0FF" w:val="clear"/>').join('');

  // Remove placeholder legal note
  xml = xml.split(' [Legal to confirm whether full T&amp;Cs are incorporated by reference or attached as a schedule.]').join('');

  // Blank out "Date" labels in signature cells (keep paragraph for spacing)
  const dateLabelPara      = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Merriweather" w:cs="Merriweather" w:eastAsia="Merriweather" w:hAnsi="Merriweather"/><w:i/><w:iCs/><w:color w:val="555B63"/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve">Date</w:t></w:r></w:p>';
  const dateLabelParaBlank = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Merriweather" w:cs="Merriweather" w:eastAsia="Merriweather" w:hAnsi="Merriweather"/><w:i/><w:iCs/><w:color w:val="555B63"/><w:sz w:val="14"/><w:szCs w:val="14"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>';
  xml = xml.split(dateLabelPara).join(dateLabelParaBlank);

  // Insert page break before "Marketing Costs and Consumption"
  xml = xml.split(
    '<w:p><w:pPr><w:spacing w:after="120" w:before="160"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Merriweather" w:cs="Merriweather" w:eastAsia="Merriweather" w:hAnsi="Merriweather"/><w:b/><w:bCs/><w:color w:val="07756C"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">Marketing Costs and Consumption</w:t></w:r></w:p>'
  ).join(
    '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:after="120" w:before="160"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Merriweather" w:cs="Merriweather" w:eastAsia="Merriweather" w:hAnsi="Merriweather"/><w:b/><w:bCs/><w:color w:val="07756C"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">Marketing Costs and Consumption</w:t></w:r></w:p>'
  );

  // Insert page break before "Plan & Pricing"
  xml = xml.split(
    '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:color="B2EDD8" w:sz="8"/></w:pBdr><w:spacing w:after="180" w:before="260"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Special Gothic Expanded" w:cs="Special Gothic Expanded" w:eastAsia="Special Gothic Expanded" w:hAnsi="Special Gothic Expanded"/><w:b/><w:bCs/><w:color w:val="07756C"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">Plan &amp; Pricing</w:t></w:r></w:p>'
  ).join(
    '<w:p><w:pPr><w:pageBreakBefore/><w:pBdr><w:bottom w:val="single" w:color="B2EDD8" w:sz="8"/></w:pBdr><w:spacing w:after="180" w:before="260"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Special Gothic Expanded" w:cs="Special Gothic Expanded" w:eastAsia="Special Gothic Expanded" w:hAnsi="Special Gothic Expanded"/><w:b/><w:bCs/><w:color w:val="07756C"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t xml:space="preserve">Plan &amp; Pricing</w:t></w:r></w:p>'
  );

  docEntry.data = Buffer.from(xml, 'utf8');
  return buildZip(entries);
}

async function getOwnerName(ownerId) {
  if (!ownerId) return '';
  const resp = await httpsRequest('GET', 'api.hubapi.com',
    '/crm/v3/owners/' + ownerId,
    { 'Authorization': 'Bearer ' + process.env.HUBSPOT_PRIVATE_APP_TOKEN }
  );
  if (resp.status === 200 && resp.body.firstName) {
    return (resp.body.firstName + ' ' + (resp.body.lastName || '')).trim();
  }
  return '';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

exports.main = async (event, callback) => {
  const p = event.inputFields;

  // Validate required fields before doing any work
  const missing = [];
  if (!p.dealname)                              missing.push('dealname');
  if (!p.signer_email)                          missing.push('signer_email');
  if (!p.full_name)                             missing.push('full_name');
  if (!p.pricing_tier)                          missing.push('pricing_tier');
  if (!p.contract_length)                       missing.push('contract_length');
  if (!p.payment_frequency)                     missing.push('payment_frequency');
  if (!p.contract_monthly_subscription_display) missing.push('contract_monthly_subscription_display');
  if (!p.contract_pricing_summary)              missing.push('contract_pricing_summary');
  if (!p.contract_pricing_breakdown_table)      missing.push('contract_pricing_breakdown_table');
  if (!p.contract_setup_fee_display)            missing.push('contract_setup_fee_display');
  if (!p.contract_vat_rate_display)             missing.push('contract_vat_rate_display');
  if (missing.length > 0) throw new Error('Missing required fields: ' + missing.join(', '));

  const today = new Date();
  const effectiveDate = today.getDate().toString().padStart(2, '0') + '/' +
                        (today.getMonth() + 1).toString().padStart(2, '0') + '/' +
                        today.getFullYear();

  const values = {
    company_legal_name:                    p.dealname,
    pricing_tier:                          p.pricing_tier,
    card_processing_included:              p.card_processing_included,
    contract_length:                       p.contract_length,
    payment_frequency:                     p.payment_frequency,
    contract_add_ons_summary:              p.contract_add_ons_summary,
    contract_monthly_subscription_display: p.contract_monthly_subscription_display,
    contract_pricing_summary:              p.contract_pricing_summary,
    contract_pricing_breakdown_table:      p.contract_pricing_breakdown_table,
    contract_card_rate_disclosure:         p.contract_card_rate_disclosure,
    contract_manual_email_rate:            p.contract_manual_email_rate,
    contract_manual_sms_rate:              p.contract_manual_sms_rate,
    contract_setup_fee_display:            p.contract_setup_fee_display,
    contract_setup_discount_display:       p.contract_setup_discount_display,
    contract_vat_rate_display:             p.contract_vat_rate_display,
    contract_setup_total_due_display:      p.contract_setup_total_due_display,
    contract_bae_clause_block:             p.contract_bae_clause_block,
    contract_website_clause_block:         p.contract_website_clause_block,
    contact_full_name:                     p.full_name,
    sales_rep_name:                        await getOwnerName(p.sales_rep_name),
    contract_effective_date:               effectiveDate,
    signature_date:                        effectiveDate,
  };

  console.log('Fetching template...');
  const templateBuffer = await fetchBuffer(TEMPLATE_URL);
  console.log('Template size:', templateBuffer.length, 'bytes');

  console.log('Pre-filling document...');
  const filledBuffer = prefillDocx(templateBuffer, values);
  const docBase64    = filledBuffer.toString('base64');
  console.log('Filled doc size:', (docBase64.length / 1024).toFixed(0), 'KB (base64)');

  console.log('Getting access token...');
  const token = await getAccessToken();
  const auth  = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

  console.log('Creating and sending envelope...');
  const envResp = await httpsRequest('POST', API_HOST,
    '/restapi/v2.1/accounts/' + ACCOUNT_ID + '/envelopes',
    auth,
    {
      status: 'sent',
      emailSubject: 'Your Barespace Subscription Agreement — ' + p.dealname,
      recipients: {
        signers: [{
          email:        p.signer_email,
          name:         p.full_name,
          recipientId:  '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [{
              anchorString:             'Title: Owner',
              anchorXOffset:            '0',
              anchorYOffset:            '60',
              anchorIgnoreIfNotPresent: 'false',
              anchorUnits:              'pixels',
              tabLabel:                 ' ',
            }],
          },
        }],
      },
      documents: [{
        documentId:     '1',
        name:           'Barespace_Contract.docx',
        fileExtension:  'docx',
        documentBase64: docBase64,
      }],
    }
  );

  if (envResp.status !== 201) {
    throw new Error('Envelope creation failed (' + envResp.status + '): ' + JSON.stringify(envResp.body));
  }

  const envelopeId = envResp.body.envelopeId;
  console.log('Envelope sent:', envelopeId);

  callback({ outputFields: {
    docusign_envelope_id:  envelopeId,
    contract_docusign_url: 'https://apps.docusign.com/send/documents/details/' + envelopeId,
  }});
};
