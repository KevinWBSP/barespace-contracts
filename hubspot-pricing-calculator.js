/**
 * BARESPACE PRICING CALCULATOR — HubSpot Workflow Custom Code Action
 * Q3 2026 pricing architecture (updated Oct 2026)
 *
 * INPUT FIELDS (map in the action's "Input fields" panel):
 *   pricing_tier, card_processing_included,
 *   add_on_bae, add_on_website, add_on_voice, add_on_pulse,
 *   contract_length, payment_frequency,
 *   number_of_locations, number_of_staff, card_volume_band,
 *   manual_price_override,
 *   addon_bae_price_override, addon_website_price_override,
 *   addon_voice_price_override, addon_pulse_price_override,
 *   card_rate_pct_override, card_rate_fixed_override,
 *   email_rate, sms_rate,
 *   subscription_discount_pct,
 *   addon_bae_discount_pct, addon_website_discount_pct,
 *   addon_voice_discount_pct, addon_pulse_discount_pct,
 *   pipeline, deal_name, sales_rep_name,
 *   recipient_email, recipient_first_name, recipient_last_name
 *
 * OUTPUT written directly to deal properties:
 *   contract_monthly_subscription, contract_monthly_subscription_display,
 *   monthlyrate, contract_annual_billed_total,
 *   contract_discount_percentage_applied, contract_add_ons_summary,
 *   contract_card_rate_disclosure, contract_pricing_summary,
 *   contract_pricing_breakdown_table,
 *   contract_bae_clause_block, contract_website_clause_block,
 *   contract_ai_terms_block, contract_early_termination,
 *   contract_manual_email_rate, contract_manual_sms_rate,
 *   contract_vat_rate_display, contract_concierge_description,
 *   contract_pricing_flag,
 *   subscription_discount_pct,
 *   addon_bae_discount_pct, addon_website_discount_pct,
 *   addon_voice_discount_pct, addon_pulse_discount_pct
 */

const hubspot = require('@hubspot/api-client');

exports.main = async (event, callback) => {
  const inputs = event.inputFields;

  const tier              = (inputs.pricing_tier || '').trim();
  const cardIncluded      = (inputs.card_processing_included || 'Yes').trim();
  const addonBae          = String(inputs.add_on_bae     || '').trim().toLowerCase() === 'yes' || inputs.add_on_bae     === true;
  const addonWebsite      = String(inputs.add_on_website || '').trim().toLowerCase() === 'yes' || inputs.add_on_website === true;
  const addonVoice        = String(inputs.add_on_voice   || '').trim().toLowerCase() === 'yes' || inputs.add_on_voice   === true;
  const addonPulse        = String(inputs.add_on_pulse   || '').trim().toLowerCase() === 'yes' || inputs.add_on_pulse   === true;
  const contractLength    = (inputs.contract_length    || '12-month').trim();
  const paymentFrequency  = (inputs.payment_frequency  || 'Monthly').trim();
  const numberOfLocations = (inputs.number_of_locations || '1 Location').trim();
  const numberOfStaff     = parseInt(inputs.number_of_staff, 10) || 1;
  const cardVolumeBand    = (inputs.card_volume_band || '').trim();

  const manualOverride        = inputs.manual_price_override;
  const manualEmailRate       = inputs.email_rate;
  const manualSmsRate         = inputs.sms_rate;
  const baePriceOverride      = inputs.addon_bae_price_override;
  const websitePriceOverride  = inputs.addon_website_price_override;
  const voicePriceOverride    = inputs.addon_voice_price_override;
  const pulsePriceOverride    = inputs.addon_pulse_price_override;
  const cardRatePctOverride   = inputs.card_rate_pct_override;
  const cardRateFixedOverride = inputs.card_rate_fixed_override;

  const subscriptionDiscountPct = inputs.subscription_discount_pct;
  const baeDiscountPct          = inputs.addon_bae_discount_pct;
  const websiteDiscountPct      = inputs.addon_website_discount_pct;
  const voiceDiscountPct        = inputs.addon_voice_discount_pct;
  const pulseDiscountPct        = inputs.addon_pulse_discount_pct;

  const onlineDepositsUsed = String(inputs.online_deposits_used || '').trim().toLowerCase() === 'yes' || inputs.online_deposits_used === true;

  console.log('CARD_OVERRIDE_CHECK: pct=' + JSON.stringify(cardRatePctOverride) + ' fixed=' + JSON.stringify(cardRateFixedOverride));

  const dealName           = inputs.deal_name            || '';
  const recipientEmail     = inputs.recipient_email      || '';
  const recipientFirstName = inputs.recipient_first_name || '';
  const recipientLastName  = inputs.recipient_last_name  || '';

  const UK_PIPELINE_ID = '47415500';
  const pipelineId     = String(inputs.pipeline || '').trim();
  const isUK           = pipelineId === UK_PIPELINE_ID;
  const currencySymbol = isUK ? '\u00a3' : '\u20ac';

  function fmt(n) {
    return currencySymbol + n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const flags = [];

  const vatRatePct     = isUK ? 0 : 23;
  const vatRateDisplay = vatRatePct.toFixed(2) + '%';

  const conciergeDescription = 'The Barespace Concierge team will assist in your onboarding, taking care of Account Creation, training of relevant members of the team, and transferring from your previous booking system if required.';

  const manualEmailRateDisplay = (manualEmailRate !== undefined && manualEmailRate !== null && manualEmailRate !== '' && !isNaN(Number(manualEmailRate))) ? fmt(Number(manualEmailRate)) : '';
  const manualSmsRateDisplay   = (manualSmsRate   !== undefined && manualSmsRate   !== null && manualSmsRate   !== '' && !isNaN(Number(manualSmsRate)))   ? fmt(Number(manualSmsRate))   : '';
  if (!manualEmailRateDisplay) flags.push('No manual email campaign rate entered on this deal \u2014 the Marketing Costs table will show a blank rate.');
  if (!manualSmsRateDisplay)   flags.push('No manual SMS campaign rate entered on this deal \u2014 the Marketing Costs table will show a blank rate.');

  var BASE_PRICE_CARD_INCLUDED = { Solo: 79,  Base: 114, Core: 139 };
  var BASE_PRICE_NO_CARD       = { Solo: 64,  Base: 99,  Core: 139 };
  var ADDON_PRICE              = { Solo: 50,  Base: 75,  Core: 100 };
  var VOICE_PRICE_ONE_STAFF    = 99;
  var VOICE_PRICE_MULTI_STAFF  = 249;
  var PULSE_PRICE              = 99;

  function cardRateData(band) {
    var map = {
      'Under \u20ac10k':     { pct: 1.2, fixed: 0.20 },
      '\u20ac10k-\u20ac20k': { pct: 1.1, fixed: 0.15 },
      'Over \u20ac20k':      { pct: 1.0, fixed: 0.10 },
    };
    return map[band] || null;
  }

  function buildEarlyTerminationBlock() {
    if (contractLength !== '12-month') return '';
    var fee = isUK ? '\u00a3500' : '\u20ac500';
    return 'Early Termination. The Client may terminate this Agreement before the end of the 12-month Subscription Term by giving Barespace no less than 30 days\u2019 written notice and paying an early termination fee of ' + fee + '. Barespace will confirm the termination date in writing upon receipt of the notice and cleared payment. All fees paid prior to the effective termination date are non-refundable.';
  }

  function buildAiTermsBlock() {
    if (!addonVoice && !addonPulse) return '';

    var jurisdictionBlock = isUK
      ? 'United Kingdom. This Agreement is governed by the law of England and Wales and the courts of England and Wales have exclusive jurisdiction. The Customer agrees that, having regard to the Fees, its ability to check AI Output and to insure, and its opportunity to negotiate, clauses 6, 7 and 8 are fair and reasonable for the purposes of the Unfair Contract Terms Act 1977 and the Misrepresentation Act 1967. Late payments carry interest and compensation under the Late Payment of Commercial Debts (Interest) Act 1998. The Contracts (Rights of Third Parties) Act 1999 does not apply. The UK GDPR and the Data Protection Act 2018 apply.'
      : 'Ireland. This Agreement is governed by the laws of Ireland and the courts of Ireland have exclusive jurisdiction. The Customer agrees that clauses 6, 7 and 8 are fair and reasonable, including for the purposes of the Sale of Goods and Supply of Services Act 1980. Late payments carry interest and costs under the European Communities (Late Payment in Commercial Transactions) Regulations 2012. Voice Receptionist discloses that it is an AI as Article 50 of the EU AI Act requires. The GDPR and the Data Protection Act 2018 apply.';

    return [
      '1. Nature of AI. The Services use artificial intelligence, which can mishear, misunderstand, misstate or act incorrectly. AI Output (including bookings, cancellations, changes, reports and financial figures) is an aid only and is not guaranteed to be accurate, complete or timely.',
      '2. Customer responsibility. The Customer is solely responsible for its configuration (services, prices, hours, staff and policies), for who has access, and for its diary, finances, tax and legal compliance. The Customer must (a) review its diary at least [daily], (b) keep automatic booking confirmations switched on, (c) review changes made by Pulse, and (d) check financial figures against source records before relying on them. The Customer must not use Pulse output for payroll, commission or tax filings without independent verification.',
      '3. Authorised Instructions. The Customer is bound by every instruction or approval given through the Services using its users\u2019 credentials, as the AI interprets it, and is responsible for user access.',
      '4. No advice. AI Output is not accounting, tax, legal, medical, health, allergy or safety advice. The Services are not for emergencies. The Customer remains responsible for consultations, patch tests, consents and treatment suitability.',
      '5. Reporting errors. The Customer must report any suspected error within [7] days and take reasonable steps to limit its effect. Barespace\u2019s logs, transcripts and records are conclusive evidence of what the Services received and did, unless there is a manifest error.',
      '6. Warranty. Barespace will provide the Services with reasonable skill and care. Otherwise the Services and AI Output are provided \u201cas is\u201d, and all other warranties and implied terms are excluded to the fullest extent the law allows. The Customer has not relied on any statement that is not in this Agreement.',
      '7. Excluded loss. Subject to clause 9, Barespace is not liable, in contract, tort (including negligence) or otherwise, for: loss of profit, revenue, income, bookings, business or goodwill; refunds, discounts or compensation given to Customer Clients; fines, penalties and tax; loss of data; loss caused by errors in AI Output, Authorised Instructions, the Customer\u2019s configuration, or failures of third parties (telecoms, AI, cloud or payment providers); or any indirect or consequential loss, even if foreseeable.',
      '8. Cap and remedy. Subject to clause 9, Barespace\u2019s total liability for all claims in any contract year is limited to the Fees paid for the affected Service in the [12] months before the first event giving rise to liability. For an error caused by a defect in the Services, the Customer\u2019s sole remedy is correction of the defect and a credit of no more than the Fees for the affected period. Claims must be notified in writing within [6] months of the Customer becoming aware of them. Each limit in clauses 7 and 8 is separate and applies to the greatest extent that is reasonable.',
      '9. Liability that is not limited. Nothing in this Agreement limits liability for death or personal injury caused by negligence, for fraud, or for anything that cannot lawfully be limited.',
      '10. Indemnity. The Customer will indemnify Barespace against third-party claims (including from Customer Clients and regulators), and the resulting losses and reasonable legal costs, arising from the Customer\u2019s configuration, data or policies, Authorised Instructions, or breach of these terms.',
      '11. Third parties and availability. The Services depend on third parties and Barespace does not guarantee uninterrupted or error-free operation. Barespace may update models, features and providers at any time. Barespace owes no duty to Customer Clients.',
      '12. Calls and data. Calls may be recorded and transcribed. Voice Receptionist will tell callers it is an AI, and the Customer must not disable this and must give callers any recording notices the law requires. Barespace processes Customer Client personal data as processor under the data processing agreement.',
      '13. Business use. The Customer confirms it is a business using the Services for its trade or profession and in connection with its main business activity.',
      '14. Precedence. These terms prevail over any conflicting term about the Services.',
      jurisdictionBlock,
    ].join('\n\n');
  }

  function buildBreakdown(opts) {
    var subscriptionLines    = opts.subscriptionLines;
    var addonBaePrice        = opts.addonBaePrice;
    var addonWebsitePrice    = opts.addonWebsitePrice;
    var addonVoicePrice      = opts.addonVoicePrice;
    var addonPulsePrice      = opts.addonPulsePrice;
    var baeHasOverride       = opts.baeHasOverride;
    var websiteHasOverride   = opts.websiteHasOverride;
    var voiceHasOverride     = opts.voiceHasOverride;
    var pulseHasOverride     = opts.pulseHasOverride;
    var cardRateDisclosure     = opts.cardRateDisclosure;
    var cardRateDisclosureText = opts.cardRateDisclosureText || '';
    var totalLabel           = opts.totalLabel;
    var totalAmount          = opts.totalAmount;
    var baeBasePrice         = opts.baeBasePrice     || 0;
    var baeDiscountApplied   = opts.baeDiscountApplied   || false;
    var baeDiscountAmount    = opts.baeDiscountAmount    || 0;
    var baeDiscountPctNum    = opts.baeDiscountPctNum    || 0;
    var websiteBasePrice     = opts.websiteBasePrice  || 0;
    var websiteDiscountApplied = opts.websiteDiscountApplied || false;
    var websiteDiscountAmount  = opts.websiteDiscountAmount  || 0;
    var websiteDiscountPctNum  = opts.websiteDiscountPctNum  || 0;
    var voiceBasePrice       = opts.voiceBasePrice    || 0;
    var voiceDiscountApplied = opts.voiceDiscountApplied || false;
    var voiceDiscountAmount  = opts.voiceDiscountAmount  || 0;
    var voiceDiscountPctNum  = opts.voiceDiscountPctNum  || 0;
    var pulseBasePrice       = opts.pulseBasePrice    || 0;
    var pulseDiscountApplied = opts.pulseDiscountApplied || false;
    var pulseDiscountAmount  = opts.pulseDiscountAmount  || 0;
    var pulseDiscountPctNum  = opts.pulseDiscountPctNum  || 0;

    var lines = subscriptionLines.slice();

    if (addonBae) {
      var baeLabel = baeHasOverride ? 'Bae Add-on (Negotiated Rate)' : 'Bae Add-on';
      if (baeDiscountApplied) {
        lines.push(baeLabel + ': ' + fmt(baeBasePrice) + '/month');
        lines.push('Bae Add-on Discount (' + baeDiscountPctNum + '%): -' + fmt(baeDiscountAmount) + '/month');
      } else {
        lines.push(baeLabel + ': ' + fmt(addonBaePrice) + '/month');
      }
    }
    if (addonWebsite) {
      var websiteLabel = websiteHasOverride ? 'Website Add-on (Negotiated Rate)' : 'Website Add-on';
      if (websiteDiscountApplied) {
        lines.push(websiteLabel + ': ' + fmt(websiteBasePrice) + '/month');
        lines.push('Website Add-on Discount (' + websiteDiscountPctNum + '%): -' + fmt(websiteDiscountAmount) + '/month');
      } else {
        lines.push(websiteLabel + ': ' + fmt(addonWebsitePrice) + '/month');
      }
    }
    if (addonVoice) {
      var voiceLabel = voiceHasOverride ? 'Voice Add-on (Negotiated Rate)' : 'Voice Add-on';
      if (voiceDiscountApplied) {
        lines.push(voiceLabel + ': ' + fmt(voiceBasePrice) + '/month');
        lines.push('Voice Add-on Discount (' + voiceDiscountPctNum + '%): -' + fmt(voiceDiscountAmount) + '/month');
      } else {
        lines.push(voiceLabel + ': ' + fmt(addonVoicePrice) + '/month');
      }
    }
    if (addonPulse) {
      var pulseLabel = pulseHasOverride ? 'Pulse Add-on (Negotiated Rate)' : 'Pulse Add-on';
      if (pulseDiscountApplied) {
        lines.push(pulseLabel + ': ' + fmt(pulseBasePrice) + '/month');
        lines.push('Pulse Add-on Discount (' + pulseDiscountPctNum + '%): -' + fmt(pulseDiscountAmount) + '/month');
      } else {
        lines.push(pulseLabel + ': ' + fmt(addonPulsePrice) + '/month');
      }
    }

    if (cardIncluded === 'Yes') {
      lines.push('Card Processing Fee: ' + cardRateDisclosure);
    } else if (onlineDepositsUsed) {
      lines.push('Card Processing Fee (Deposits / No-shows): ' + cardRateDisclosureText);
    } else {
      lines.push('Card Processing Fee: Not included under this agreement');
    }
    lines.push('Manual Email Campaign: ' + (manualEmailRateDisplay || '[rate not set]') + ' per send');
    lines.push('Manual SMS Campaign: ' + (manualSmsRateDisplay || '[rate not set]') + ' per send');
    lines.push(totalLabel + ': ' + fmt(totalAmount));
    return lines.join('\n');
  }

  function buildClauseBlocks() {
    var bae = addonBae
      ? 'Included Services. As part of the Barespace Automated Marketing (BAE) package, you are granted full access to Barespace\u2019s automated email marketing engine. This system operates as an always-on marketing tool designed to improve the client booking journey and support revenue growth through appointment re-bookings, client re-engagement campaigns, service and product upsells, and new client referrals. Campaigns are configured and managed through the Barespace platform based on agreed campaign types and scheduling logic.'
      : '';
    var website = addonWebsite
      ? 'Included Services. As part of the Barespace Website package, Barespace will design, build, and publish a website for the Customer\u2019s business, reflecting the Customer\u2019s brand and services to the Customer\u2019s liking. The Provider will work with the Customer to agree layout, content, and design direction prior to publishing, and will incorporate reasonable revisions requested by the Customer during the build process. Once published, Barespace will maintain and host the website for the duration of this Agreement, including ongoing updates to keep the site functioning correctly and reflecting current business information as reasonably requested by the Customer. The website is provided as part of the Website add-on subscription and remains hosted on Barespace\u2019s platform; hosting, publishing, and maintenance cease if the Website add-on is removed from the Customer\u2019s plan or this Agreement ends.'
      : '';
    return { bae: bae, website: website };
  }

  function buildDiscountSentences(opts) {
    var tier               = opts.tier;
    var bundleQualifies    = opts.bundleQualifies;
    var bundleBasePct      = opts.bundleBasePct;
    var subEffectivePct    = opts.subEffectivePct;
    var subManualPct       = opts.subManualPct;
    var locationDiscountPct = opts.locationDiscountPct;
    var baeEffectivePct    = opts.baeEffectivePct;
    var baeManualPct       = opts.baeManualPct;
    var websiteEffectivePct = opts.websiteEffectivePct;
    var websiteManualPct   = opts.websiteManualPct;
    var voiceEffectivePct  = opts.voiceEffectivePct;
    var voiceManualPct     = opts.voiceManualPct;
    var pulseEffectivePct  = opts.pulseEffectivePct;
    var pulseManualPct     = opts.pulseManualPct;

    var result = [];
    var allSameBundle = bundleQualifies
      && subEffectivePct === bundleBasePct && subManualPct === 0
      && (!addonBae     || (baeEffectivePct     === bundleBasePct && baeManualPct     === 0))
      && (!addonWebsite || (websiteEffectivePct === bundleBasePct && websiteManualPct === 0))
      && (!addonVoice   || (voiceEffectivePct   === bundleBasePct && voiceManualPct   === 0))
      && (!addonPulse   || (pulseEffectivePct   === bundleBasePct && pulseManualPct   === 0));

    if (allSameBundle && subEffectivePct > 0) {
      var items = [tier + ' subscription'];
      if (addonBae)     items.push('Bae add-on');
      if (addonWebsite) items.push('Website add-on');
      if (addonVoice)   items.push('Voice add-on');
      if (addonPulse)   items.push('Pulse add-on');
      var formatted = items.length === 1
        ? items[0]
        : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
      result.push('A ' + bundleBasePct + '% multi-service bundle discount has been applied to the ' + formatted + '.');
    } else {
      if (subEffectivePct > 0)                     result.push('A ' + subEffectivePct + '% discount has been applied to the ' + tier + ' subscription.');
      if (addonBae     && baeEffectivePct     > 0) result.push('A ' + baeEffectivePct + '% discount has been applied to the Bae add-on.');
      if (addonWebsite && websiteEffectivePct > 0) result.push('A ' + websiteEffectivePct + '% discount has been applied to the Website add-on.');
      if (addonVoice   && voiceEffectivePct   > 0) result.push('A ' + voiceEffectivePct + '% discount has been applied to the Voice add-on.');
      if (addonPulse   && pulseEffectivePct   > 0) result.push('A ' + pulseEffectivePct + '% discount has been applied to the Pulse add-on.');
    }
    if (locationDiscountPct > 0) {
      result.push('A 10% discount has been applied to the base subscription as this is the customer\'s second registered Barespace location.');
    }
    return result;
  }

  var outputProps;

  if (!BASE_PRICE_CARD_INCLUDED[tier]) {
    outputProps = {
      contract_monthly_subscription:         null,
      contract_monthly_subscription_display: '',
      monthlyrate:                           null,
      contract_annual_billed_total:          null,
      contract_discount_percentage_applied:  null,
      contract_add_ons_summary:              '',
      contract_card_rate_disclosure:         '',
      contract_pricing_summary:              '',
      contract_pricing_breakdown_table:      '',
      contract_bae_clause_block:             '',
      contract_website_clause_block:         '',
      contract_ai_terms_block:               '',
      contract_early_termination:      '',
      contract_manual_email_rate:            manualEmailRateDisplay,
      contract_manual_sms_rate:              manualSmsRateDisplay,
      contract_vat_rate_display:             '',
      contract_concierge_description:        conciergeDescription,
      subscription_discount_pct:             null,
      addon_bae_discount_pct:                null,
      addon_website_discount_pct:            null,
      addon_voice_discount_pct:              null,
      addon_pulse_discount_pct:              null,
      contract_pricing_flag: 'ERROR: pricing_tier "' + tier + '" not recognised. Must be exactly "Solo", "Base", or "Core". Contract NOT generated.',
    };
  } else {
    var isValidNumber = function(v) { return v !== undefined && v !== null && v !== '' && !isNaN(Number(v)); };

    var bundleQualifies = cardIncluded === 'Yes'
      && (addonBae || addonWebsite || addonVoice || addonPulse)
      && contractLength === '12-month';
    var bundleBasePct = bundleQualifies ? 10 : 0;

    var subManualPct    = isValidNumber(subscriptionDiscountPct) && Number(subscriptionDiscountPct) > 0 ? Number(subscriptionDiscountPct) : 0;
    var subEffectivePct = subManualPct > 0 ? subManualPct : bundleBasePct;

    var baeHasOverride    = addonBae && isValidNumber(baePriceOverride);
    var baeBasePrice      = addonBae ? (baeHasOverride ? Number(baePriceOverride) : ADDON_PRICE[tier]) : 0;
    var baeManualPct      = isValidNumber(baeDiscountPct) && Number(baeDiscountPct) > 0 ? Number(baeDiscountPct) : 0;
    var baeEffectivePct   = addonBae ? (baeManualPct > 0 ? baeManualPct : bundleBasePct) : 0;
    var baeDiscountAmount = addonBae ? Math.round(baeBasePrice * (baeEffectivePct / 100) * 100) / 100 : 0;
    var addonBaePrice     = addonBae ? Math.round((baeBasePrice - baeDiscountAmount) * 100) / 100 : 0;

    var websiteHasOverride    = addonWebsite && isValidNumber(websitePriceOverride);
    var websiteBasePrice      = addonWebsite ? (websiteHasOverride ? Number(websitePriceOverride) : ADDON_PRICE[tier]) : 0;
    var websiteManualPct      = isValidNumber(websiteDiscountPct) && Number(websiteDiscountPct) > 0 ? Number(websiteDiscountPct) : 0;
    var websiteEffectivePct   = addonWebsite ? (websiteManualPct > 0 ? websiteManualPct : bundleBasePct) : 0;
    var websiteDiscountAmount = addonWebsite ? Math.round(websiteBasePrice * (websiteEffectivePct / 100) * 100) / 100 : 0;
    var addonWebsitePrice     = addonWebsite ? Math.round((websiteBasePrice - websiteDiscountAmount) * 100) / 100 : 0;

    var voiceStandardPrice  = numberOfStaff <= 1 ? VOICE_PRICE_ONE_STAFF : VOICE_PRICE_MULTI_STAFF;
    var voiceHasOverride    = addonVoice && isValidNumber(voicePriceOverride);
    var voiceBasePrice      = addonVoice ? (voiceHasOverride ? Number(voicePriceOverride) : voiceStandardPrice) : 0;
    var voiceManualPct      = isValidNumber(voiceDiscountPct) && Number(voiceDiscountPct) > 0 ? Number(voiceDiscountPct) : 0;
    var voiceEffectivePct   = addonVoice ? (voiceManualPct > 0 ? voiceManualPct : bundleBasePct) : 0;
    var voiceDiscountAmount = addonVoice ? Math.round(voiceBasePrice * (voiceEffectivePct / 100) * 100) / 100 : 0;
    var addonVoicePrice     = addonVoice ? Math.round((voiceBasePrice - voiceDiscountAmount) * 100) / 100 : 0;

    var pulseHasOverride    = addonPulse && isValidNumber(pulsePriceOverride);
    var pulseBasePrice      = addonPulse ? (pulseHasOverride ? Number(pulsePriceOverride) : PULSE_PRICE) : 0;
    var pulseManualPct      = isValidNumber(pulseDiscountPct) && Number(pulseDiscountPct) > 0 ? Number(pulseDiscountPct) : 0;
    var pulseEffectivePct   = addonPulse ? (pulseManualPct > 0 ? pulseManualPct : bundleBasePct) : 0;
    var pulseDiscountAmount = addonPulse ? Math.round(pulseBasePrice * (pulseEffectivePct / 100) * 100) / 100 : 0;
    var addonPulsePrice     = addonPulse ? Math.round((pulseBasePrice - pulseDiscountAmount) * 100) / 100 : 0;

    var addonsTotal = addonBaePrice + addonWebsitePrice + addonVoicePrice + addonPulsePrice;

    var cardRateHasOverride = isValidNumber(cardRatePctOverride) || isValidNumber(cardRateFixedOverride);
    var standardRate = cardRateData(cardVolumeBand);
    var pctToUse   = isValidNumber(cardRatePctOverride)   ? Number(cardRatePctOverride)   : (standardRate ? standardRate.pct   : null);
    var fixedToUse = isValidNumber(cardRateFixedOverride) ? Number(cardRateFixedOverride) : (standardRate ? standardRate.fixed : null);
    var negotiatedSuffix = cardRateHasOverride ? ' (negotiated rate)' : '';

    var cardRateDisclosureText;
    if (pctToUse !== null && fixedToUse !== null) {
      cardRateDisclosureText = pctToUse + '% + ' + fmt(fixedToUse) + ' per transaction' + negotiatedSuffix;
    } else if (pctToUse !== null) {
      cardRateDisclosureText = pctToUse + '% per transaction' + negotiatedSuffix;
    } else if (fixedToUse !== null) {
      cardRateDisclosureText = fmt(fixedToUse) + ' per transaction' + negotiatedSuffix;
    } else {
      cardRateDisclosureText = 'Rate to be confirmed based on expected monthly transaction volume \u2014 select a volume band on the deal.';
      if (cardIncluded === 'Yes' || onlineDepositsUsed) flags.push('No card volume band selected \u2014 card processing rate disclosure is incomplete. Set "Card Volume Band" on the deal before sending.');
    }

    var cardRateDisclosure;
    if (cardIncluded === 'Yes') {
      cardRateDisclosure = cardRateDisclosureText;
    } else if (onlineDepositsUsed) {
      cardRateDisclosure = cardRateDisclosureText + ' (applies to online deposits and no-show charges)';
    } else {
      cardRateDisclosure = 'Not included under this agreement';
    }

    var addonsSummaryParts = [];
    if (addonBae)     addonsSummaryParts.push('Bae');
    if (addonWebsite) addonsSummaryParts.push('Website');
    if (addonVoice)   addonsSummaryParts.push('Voice');
    if (addonPulse)   addonsSummaryParts.push('Pulse');
    var addonsSummary = addonsSummaryParts.join(', ') || 'None';

    var isThirdPlusLocation = numberOfLocations.indexOf('3+') === 0;
    var hasManualOverride   = manualOverride !== undefined && manualOverride !== null && manualOverride !== '' && !isNaN(Number(manualOverride));

    if (isThirdPlusLocation && !hasManualOverride) {
      outputProps = {
        contract_monthly_subscription:         null,
        contract_monthly_subscription_display: '',
        monthlyrate:                           null,
        contract_annual_billed_total:          null,
        contract_discount_percentage_applied:  null,
        contract_add_ons_summary:              addonsSummary,
        contract_card_rate_disclosure:         cardRateDisclosure,
        contract_pricing_summary:              '',
        contract_pricing_breakdown_table:      '',
        contract_bae_clause_block:             '',
        contract_website_clause_block:         '',
        contract_ai_terms_block:               '',
        contract_early_termination:      '',
        contract_manual_email_rate:            manualEmailRateDisplay,
        contract_manual_sms_rate:              manualSmsRateDisplay,
        contract_vat_rate_display:             vatRateDisplay,
        contract_concierge_description:        conciergeDescription,
        subscription_discount_pct:             null,
        addon_bae_discount_pct:                null,
        addon_website_discount_pct:            null,
        addon_voice_discount_pct:              null,
        addon_pulse_discount_pct:              null,
        contract_pricing_flag: 'MANUAL PRICING REQUIRED: 3rd+ location deals are case-by-case. Enter the negotiated monthly amount in "Manual Price Override" on this deal, then re-run this workflow action.',
      };
    } else if (hasManualOverride) {
      var overrideAmount           = Number(manualOverride);
      var subDiscountAmountOvr     = Math.round(overrideAmount * (subEffectivePct / 100) * 100) / 100;
      var overrideAfterSubDiscount = Math.round((overrideAmount - subDiscountAmountOvr) * 100) / 100;

      var overrideBase        = overrideAfterSubDiscount;
      var locationDiscountPct = 0;
      if (numberOfLocations.indexOf('2') === 0) {
        locationDiscountPct = 10;
        overrideBase = Math.round(overrideBase * 0.9 * 100) / 100;
        flags.push('2nd-location discount applied to the negotiated base subscription.');
      }
      var locationDiscountAmountOvr = Math.round((overrideAfterSubDiscount - overrideBase) * 100) / 100;
      var monthlyFinalOvr           = Math.round((overrideBase + addonsTotal) * 100) / 100;

      if (locationDiscountPct > 0 && bundleQualifies) {
        flags.push('Both the 2nd-location discount AND the 12-month bundle discount are applying on top of the manual override \u2014 confirm this is correct before sending.');
      }

      var annualBilledTotalOvr = null;
      if (contractLength === '12-month' && paymentFrequency === 'Annual upfront') {
        annualBilledTotalOvr = Math.round(monthlyFinalOvr * 10 * 100) / 100;
      }

      var monthlyFinalDisplayOvr = fmt(monthlyFinalOvr);

      var sentencesOvr = [];
      sentencesOvr.push('This agreement is for the Barespace ' + tier + ' plan at a negotiated base subscription rate of ' + fmt(overrideAmount) + '/month, as agreed directly between Barespace and the customer.');
      sentencesOvr.push(addonsSummary === 'None' ? 'No add-on services are included in this agreement.' : 'This agreement includes the following add-on service(s): ' + addonsSummary + '.');
      var discountSentsOvr = buildDiscountSentences({ tier: tier, bundleQualifies: bundleQualifies, bundleBasePct: bundleBasePct, subEffectivePct: subEffectivePct, subManualPct: subManualPct, locationDiscountPct: locationDiscountPct, baeEffectivePct: baeEffectivePct, baeManualPct: baeManualPct, websiteEffectivePct: websiteEffectivePct, websiteManualPct: websiteManualPct, voiceEffectivePct: voiceEffectivePct, voiceManualPct: voiceManualPct, pulseEffectivePct: pulseEffectivePct, pulseManualPct: pulseManualPct });
      discountSentsOvr.forEach(function(s) { sentencesOvr.push(s); });
      sentencesOvr.push('Contract term: ' + contractLength + '.');
      if (annualBilledTotalOvr !== null) {
        sentencesOvr.push('Payment: the full amount of ' + fmt(annualBilledTotalOvr) + ' is billed upfront, covering 12 months of service billed at 10 months\u2019 rate.');
      } else if (contractLength === '12-month') {
        sentencesOvr.push('Payment: billed monthly at ' + monthlyFinalDisplayOvr + '/month for the duration of the 12-month term.');
      } else {
        sentencesOvr.push('Payment: billed monthly at ' + monthlyFinalDisplayOvr + '/month, with no fixed term.');
      }
      if (cardIncluded === 'Yes') {
        sentencesOvr.push('A Barespace card terminal is included under this agreement. All card transactions processed through the Barespace platform, including terminal payments, online deposits, and no-show charges, are subject to a usage-based processing fee of ' + cardRateDisclosureText + ', payable to Barespace from settled transaction volume. This processing fee is separate from, and in addition to, the subscription amount above.');
      } else if (onlineDepositsUsed) {
        sentencesOvr.push('Although a card terminal is not included under this agreement, card payments processed through the Barespace platform for online deposits and no-show charges remain subject to a usage-based processing fee of ' + cardRateDisclosureText + ', payable to Barespace from settled transaction volume. This processing fee is separate from, and in addition to, the subscription amount above.');
      }

      var subLinesOvr = ['Barespace ' + tier + ' Subscription (Negotiated Rate): ' + fmt(overrideAmount) + '/month'];
      if (subEffectivePct     > 0) subLinesOvr.push('Subscription Discount (' + subEffectivePct + '%): -' + fmt(subDiscountAmountOvr) + '/month');
      if (locationDiscountPct > 0) subLinesOvr.push('2nd Location Discount (10%): -' + fmt(locationDiscountAmountOvr) + '/month');

      var clauseBlocksOvr = buildClauseBlocks();

      var flagPartsOvr = ['Manual override price used for the base subscription.'];
      var appliedDiscountsOvr = [];
      if (bundleQualifies)                       appliedDiscountsOvr.push('10% multi-service bundle');
      if (locationDiscountPct > 0)               appliedDiscountsOvr.push('10% 2nd location');
      if (subManualPct > 0)                      appliedDiscountsOvr.push(subManualPct + '% custom subscription');
      if (addonBae     && baeManualPct     > 0)  appliedDiscountsOvr.push(baeManualPct + '% custom Bae');
      if (addonWebsite && websiteManualPct > 0)  appliedDiscountsOvr.push(websiteManualPct + '% custom Website');
      if (addonVoice   && voiceManualPct   > 0)  appliedDiscountsOvr.push(voiceManualPct + '% custom Voice');
      if (addonPulse   && pulseManualPct   > 0)  appliedDiscountsOvr.push(pulseManualPct + '% custom Pulse');
      flagPartsOvr.push(appliedDiscountsOvr.length > 0
        ? 'Discounts applied on top of override: ' + appliedDiscountsOvr.join(', ') + '. Confirm all figures are correct before sending.'
        : 'No automatic discounts applied. Confirm the override figure is correct before sending.');
      flags.forEach(function(f) { flagPartsOvr.push(f); });

      outputProps = {
        contract_monthly_subscription:         monthlyFinalOvr,
        contract_monthly_subscription_display: monthlyFinalDisplayOvr,
        monthlyrate:                           monthlyFinalOvr,
        contract_annual_billed_total:          annualBilledTotalOvr,
        contract_discount_percentage_applied:  subEffectivePct + locationDiscountPct,
        contract_add_ons_summary:              addonsSummary,
        contract_card_rate_disclosure:         cardRateDisclosure,
        contract_pricing_summary:              sentencesOvr.join(' '),
        contract_pricing_breakdown_table:      buildBreakdown({ subscriptionLines: subLinesOvr, addonBaePrice: addonBaePrice, addonWebsitePrice: addonWebsitePrice, addonVoicePrice: addonVoicePrice, addonPulsePrice: addonPulsePrice, baeHasOverride: baeHasOverride, websiteHasOverride: websiteHasOverride, voiceHasOverride: voiceHasOverride, pulseHasOverride: pulseHasOverride, cardRateDisclosure: cardRateDisclosure, cardRateDisclosureText: cardRateDisclosureText, totalLabel: 'Total Monthly Subscription', totalAmount: monthlyFinalOvr, baeBasePrice: baeBasePrice, baeDiscountApplied: addonBae && baeEffectivePct > 0, baeDiscountAmount: baeDiscountAmount, baeDiscountPctNum: baeEffectivePct, websiteBasePrice: websiteBasePrice, websiteDiscountApplied: addonWebsite && websiteEffectivePct > 0, websiteDiscountAmount: websiteDiscountAmount, websiteDiscountPctNum: websiteEffectivePct, voiceBasePrice: voiceBasePrice, voiceDiscountApplied: addonVoice && voiceEffectivePct > 0, voiceDiscountAmount: voiceDiscountAmount, voiceDiscountPctNum: voiceEffectivePct, pulseBasePrice: pulseBasePrice, pulseDiscountApplied: addonPulse && pulseEffectivePct > 0, pulseDiscountAmount: pulseDiscountAmount, pulseDiscountPctNum: pulseEffectivePct }),
        contract_bae_clause_block:           clauseBlocksOvr.bae,
        contract_website_clause_block:       clauseBlocksOvr.website,
        contract_ai_terms_block:             buildAiTermsBlock(),
        contract_early_termination:    buildEarlyTerminationBlock(),
        contract_manual_email_rate:          manualEmailRateDisplay,
        contract_manual_sms_rate:       manualSmsRateDisplay,
        contract_vat_rate_display:      vatRateDisplay,
        contract_concierge_description: conciergeDescription,
        subscription_discount_pct:      subEffectivePct,
        addon_bae_discount_pct:         addonBae     ? baeEffectivePct     : 0,
        addon_website_discount_pct:     addonWebsite ? websiteEffectivePct : 0,
        addon_voice_discount_pct:       addonVoice   ? voiceEffectivePct   : 0,
        addon_pulse_discount_pct:       addonPulse   ? pulseEffectivePct   : 0,
        contract_pricing_flag:          flagPartsOvr.join(' '),
      };
    } else {
      var tierBaseRaw = cardIncluded === 'No' ? BASE_PRICE_NO_CARD[tier] : BASE_PRICE_CARD_INCLUDED[tier];

      if (cardIncluded === 'No' && tier === 'Core') {
        flags.push('Note: Core tier pricing is the same with or without card \u2014 card processing is free at Core.');
      }

      var subDiscountAmountStd    = Math.round(tierBaseRaw * (subEffectivePct / 100) * 100) / 100;
      var tierAfterSubDiscount    = Math.round((tierBaseRaw - subDiscountAmountStd) * 100) / 100;

      var base                = tierAfterSubDiscount;
      var locationDiscountPctStd = 0;
      if (numberOfLocations.indexOf('2') === 0) {
        locationDiscountPctStd = 10;
        base = Math.round(base * 0.9 * 100) / 100;
        flags.push('2nd-location discount applied to base subscription only, per standard rule. Confirm this is correct if the customer also qualifies for the bundle discount.');
      }
      var locationDiscountAmountStd = Math.round((tierAfterSubDiscount - base) * 100) / 100;
      var monthlyFinalStd           = Math.round((base + addonsTotal) * 100) / 100;

      if (locationDiscountPctStd > 0 && bundleQualifies) {
        flags.push('Both the 2nd-location discount AND the 12-month bundle discount are applying to this deal at once \u2014 this combination is not explicitly covered in the Q3 2026 pricing brief. Recommend a quick check with leadership before sending.');
      }

      var annualBilledTotalStd = null;
      if (contractLength === '12-month' && paymentFrequency === 'Annual upfront') {
        annualBilledTotalStd = Math.round(monthlyFinalStd * 10 * 100) / 100;
      }

      var monthlyFinalDisplayStd = fmt(monthlyFinalStd);

      var sentencesStd = [];
      sentencesStd.push('This agreement is for the Barespace ' + tier + ' plan at ' + monthlyFinalDisplayStd + '/month, ' + (cardIncluded === 'Yes' ? 'with card processing included' : 'without card processing') + '.');
      sentencesStd.push(addonsSummary === 'None' ? 'No add-on services are included in this agreement.' : 'This agreement includes the following add-on service(s): ' + addonsSummary + '.');
      var discountSentsStd = buildDiscountSentences({ tier: tier, bundleQualifies: bundleQualifies, bundleBasePct: bundleBasePct, subEffectivePct: subEffectivePct, subManualPct: subManualPct, locationDiscountPct: locationDiscountPctStd, baeEffectivePct: baeEffectivePct, baeManualPct: baeManualPct, websiteEffectivePct: websiteEffectivePct, websiteManualPct: websiteManualPct, voiceEffectivePct: voiceEffectivePct, voiceManualPct: voiceManualPct, pulseEffectivePct: pulseEffectivePct, pulseManualPct: pulseManualPct });
      discountSentsStd.forEach(function(s) { sentencesStd.push(s); });
      sentencesStd.push('Contract term: ' + contractLength + '.');
      if (annualBilledTotalStd !== null) {
        sentencesStd.push('Payment: the full amount of ' + fmt(annualBilledTotalStd) + ' is billed upfront, covering 12 months of service billed at 10 months\u2019 rate.');
      } else if (contractLength === '12-month') {
        sentencesStd.push('Payment: billed monthly at ' + monthlyFinalDisplayStd + '/month for the duration of the 12-month term.');
      } else {
        sentencesStd.push('Payment: billed monthly at ' + monthlyFinalDisplayStd + '/month, with no fixed term.');
      }
      if (cardIncluded === 'Yes') {
        sentencesStd.push('A Barespace card terminal is included under this agreement. All card transactions processed through the Barespace platform, including terminal payments, online deposits, and no-show charges, are subject to a usage-based processing fee of ' + cardRateDisclosureText + ', payable to Barespace from settled transaction volume. This processing fee is separate from, and in addition to, the subscription amount above.');
      } else if (onlineDepositsUsed) {
        sentencesStd.push('Although a card terminal is not included under this agreement, card payments processed through the Barespace platform for online deposits and no-show charges remain subject to a usage-based processing fee of ' + cardRateDisclosureText + ', payable to Barespace from settled transaction volume. This processing fee is separate from, and in addition to, the subscription amount above.');
      }

      var subLinesStd = ['Barespace ' + tier + ' Subscription: ' + fmt(tierBaseRaw) + '/month'];
      if (subEffectivePct        > 0) subLinesStd.push('Subscription Discount (' + subEffectivePct + '%): -' + fmt(subDiscountAmountStd) + '/month');
      if (locationDiscountPctStd > 0) subLinesStd.push('2nd Location Discount (10%): -' + fmt(locationDiscountAmountStd) + '/month');

      var clauseBlocksStd = buildClauseBlocks();

      outputProps = {
        contract_monthly_subscription:         monthlyFinalStd,
        contract_monthly_subscription_display: monthlyFinalDisplayStd,
        monthlyrate:                           monthlyFinalStd,
        contract_annual_billed_total:          annualBilledTotalStd,
        contract_discount_percentage_applied:  subEffectivePct + locationDiscountPctStd,
        contract_add_ons_summary:              addonsSummary,
        contract_card_rate_disclosure:         cardRateDisclosure,
        contract_pricing_summary:              sentencesStd.join(' '),
        contract_pricing_breakdown_table:      buildBreakdown({ subscriptionLines: subLinesStd, addonBaePrice: addonBaePrice, addonWebsitePrice: addonWebsitePrice, addonVoicePrice: addonVoicePrice, addonPulsePrice: addonPulsePrice, baeHasOverride: baeHasOverride, websiteHasOverride: websiteHasOverride, voiceHasOverride: voiceHasOverride, pulseHasOverride: pulseHasOverride, cardRateDisclosure: cardRateDisclosure, cardRateDisclosureText: cardRateDisclosureText, totalLabel: 'Total Monthly Subscription', totalAmount: monthlyFinalStd, baeBasePrice: baeBasePrice, baeDiscountApplied: addonBae && baeEffectivePct > 0, baeDiscountAmount: baeDiscountAmount, baeDiscountPctNum: baeEffectivePct, websiteBasePrice: websiteBasePrice, websiteDiscountApplied: addonWebsite && websiteEffectivePct > 0, websiteDiscountAmount: websiteDiscountAmount, websiteDiscountPctNum: websiteEffectivePct, voiceBasePrice: voiceBasePrice, voiceDiscountApplied: addonVoice && voiceEffectivePct > 0, voiceDiscountAmount: voiceDiscountAmount, voiceDiscountPctNum: voiceEffectivePct, pulseBasePrice: pulseBasePrice, pulseDiscountApplied: addonPulse && pulseEffectivePct > 0, pulseDiscountAmount: pulseDiscountAmount, pulseDiscountPctNum: pulseEffectivePct }),
        contract_bae_clause_block:           clauseBlocksStd.bae,
        contract_website_clause_block:       clauseBlocksStd.website,
        contract_ai_terms_block:             buildAiTermsBlock(),
        contract_early_termination:    buildEarlyTerminationBlock(),
        contract_manual_email_rate:          manualEmailRateDisplay,
        contract_manual_sms_rate:       manualSmsRateDisplay,
        contract_vat_rate_display:      vatRateDisplay,
        contract_concierge_description: conciergeDescription,
        subscription_discount_pct:      subEffectivePct,
        addon_bae_discount_pct:         addonBae     ? baeEffectivePct     : 0,
        addon_website_discount_pct:     addonWebsite ? websiteEffectivePct : 0,
        addon_voice_discount_pct:       addonVoice   ? voiceEffectivePct   : 0,
        addon_pulse_discount_pct:       addonPulse   ? pulseEffectivePct   : 0,
        contract_pricing_flag:          flags.join(' ') || '',
      };
    }
  }

  var propertiesForApi = {};
  Object.keys(outputProps).forEach(function(key) {
    var value = outputProps[key];
    if (value === null || value === undefined) return;
    propertiesForApi[key] = String(value);
  });

  var dealId = event.object && event.object.objectId;

  if (dealId) {
    try {
      var token = process.env.SUPER_SECRET_KEY;
      console.log('TOKEN_CHECK: present=' + (!!token) + ' length=' + (token ? token.length : 0) + ' startsWithPat=' + (token ? token.startsWith('pat-') : false));
      if (!token) throw new Error('Secret SUPER_SECRET_KEY is not available to this action. Add it under the action\'s "Secrets" dropdown.');
      var hubspotClient = new hubspot.Client({ accessToken: token });
      var result = await hubspotClient.crm.deals.basicApi.update(String(dealId), { properties: propertiesForApi });
      console.log('WRITE_OK: id=' + (result && result.id));
    } catch (err) {
      console.error('WRITE_FAILED:', err && err.code, err && err.message ? err.message.slice(0, 200) : err);
      outputProps.contract_pricing_flag = 'SCRIPT ERROR WRITING TO DEAL: ' + (err.message || err);
      try {
        var token2 = process.env.SUPER_SECRET_KEY;
        if (token2) {
          var hubspotClient2 = new hubspot.Client({ accessToken: token2 });
          await hubspotClient2.crm.deals.basicApi.update(String(dealId), { properties: { contract_pricing_flag: outputProps.contract_pricing_flag } });
        }
      } catch (err2) { /* nothing further to try */ }
    }
  } else {
    outputProps.contract_pricing_flag = 'Note: no deal ID in this run (likely a Test panel run, not live) — values calculated but not written to any record. ' + (outputProps.contract_pricing_flag || '');
  }

  callback(outputProps);
};
