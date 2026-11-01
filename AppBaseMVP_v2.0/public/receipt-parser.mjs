const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};

function normalizeDigits(value) {
  return value.replace(/[०-९]/g, digit => String(digit.charCodeAt(0) - 0x0966));
}

function validDate(year, month, day) {
  if (year < 100) year += year < 50 ? 2000 : 1900;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function datesInLine(line) {
  const dates = [];
  let match;
  const iso = /\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  while ((match = iso.exec(line))) dates.push(validDate(+match[1], +match[2], +match[3]));

  const local = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/g;
  while ((match = local.exec(line))) dates.push(validDate(+match[3], +match[2], +match[1]));

  const monthFirst = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2}|19\d{2})\b/g;
  while ((match = monthFirst.exec(line))) {
    const month = MONTHS[match[1].toLowerCase()];
    if (month) dates.push(validDate(+match[3], month, +match[2]));
  }
  const dayFirst = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(20\d{2}|19\d{2})\b/g;
  while ((match = dayFirst.exec(line))) {
    const month = MONTHS[match[2].toLowerCase()];
    if (month) dates.push(validDate(+match[3], month, +match[1]));
  }
  return dates.filter(Boolean);
}

function amountFromLine(line) {
  const matches = line.match(/(?:₹\s*|INR\s*|Rs\.?\s*)?\d[\d,]*(?:\.\d{1,2})?/gi) || [];
  const amounts = [];
  for (const match of matches) {
    const numeric = match.match(/\d[\d,]*(?:\.\d{1,2})?/);
    if (!numeric) continue;
    let value = numeric[0];
    if (!value.includes('.')) {
      if (/^\d{1,3}(?:,\d{3})+$/.test(value)) value = value.replace(/,/g, '');
      else if (/,\d{2}$/.test(value)) value = value.replace(/,(\d{2})$/, '.$1').replace(/,/g, '');
      else value = value.replace(/,/g, '');
    } else {
      value = value.replace(/,/g, '');
    }
    const amount = Number(value);
    if (Number.isFinite(amount) && amount > 0 && amount < 1000000000) amounts.push(amount);
  }
  return amounts;
}

function totalPriority(line) {
  if (/\b(sub\s*total|subtotal|tax|gst|vat|discount|savings|change|cash\s+tendered)\b/i.test(line)) return 0;
  if (/\b(grand\s*total|कुल\s*(?:राशि|योग|देय)?)\b/i.test(line)) return 5;
  if (/\b(total\s*(?:payable|paid|amount|due)|amount\s*(?:payable|paid|due)|net\s*(?:amount|payable)|देय\s*राशि)\b/i.test(line)) return 4;
  if (/\btotal\b/i.test(line) || /कुल/.test(line)) return 3;
  if (/\bamount\b/i.test(line) || /राशि/.test(line)) return 2;
  return 0;
}

function extractAmount(lines) {
  const candidates = [];
  lines.forEach((line, index) => {
    const priority = totalPriority(line);
    if (priority) {
      const onLine = amountFromLine(line);
      const nextLine = onLine.length ? [] : amountFromLine(lines[index + 1] || '');
      const amounts = onLine.length ? onLine : nextLine;
      if (amounts.length) candidates.push({ amount: amounts[amounts.length - 1], priority, index });
    } else if (/₹|\b(?:INR|Rs\.?)\s*\d/i.test(line)) {
      const amounts = amountFromLine(line);
      if (amounts.length) candidates.push({ amount: amounts[amounts.length - 1], priority: 1, index });
    }
  });
  candidates.sort((a, b) => b.priority - a.priority || b.index - a.index);
  return candidates.length ? candidates[0].amount : null;
}

function extractDate(lines) {
  const candidates = lines.flatMap((line, index) =>
    datesInLine(line).map(date => ({
      date,
      priority: /\b(date|dated|invoice\s*date|bill\s*date)\b|दिनांक|तिथि/i.test(line) ? 1 : 0,
      index
    }))
  );
  candidates.sort((a, b) => b.priority - a.priority || a.index - b.index);
  return candidates.length ? candidates[0].date : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findMode(modes, pattern) {
  return modes.find(mode => pattern.test(mode.toLowerCase())) || null;
}

function extractPaymentMode(text, modes) {
  const normalized = text.toLowerCase();
  const exact = [...modes].sort((a, b) => b.length - a.length).find(mode => {
    const phrase = mode.trim().toLowerCase();
    return phrase && new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}($|[^a-z0-9])`, 'i').test(normalized);
  });
  if (exact) return exact;

  if (/\b(upi|bhim|gpay|google\s*pay|phonepe|paytm)\b/i.test(normalized)) {
    const mode = findMode(modes, /upi|phonepe|paytm|google\s*pay|gpay/i);
    if (mode) return mode;
  }
  if (/\bcash\b|नकद/i.test(normalized)) {
    const mode = findMode(modes, /cash/i);
    if (mode) return mode;
  }
  if (/\b(debit\s*card|credit\s*card)\b/i.test(normalized)) {
    const requested = /\bdebit\s*card\b/i.test(normalized) ? /debit\s*card/i : /credit\s*card/i;
    const mode = findMode(modes, requested);
    if (mode) return mode;
  }
  if (/\bcard\b|कार्ड/i.test(normalized)) {
    const cardModes = modes.filter(mode => /\bcard\b/i.test(mode));
    if (cardModes.length === 1) return cardModes[0];
  }
  if (/\bnet\s*banking\b/i.test(normalized)) {
    const mode = findMode(modes, /net\s*banking/i);
    if (mode) return mode;
  }
  return null;
}

function extractDescription(lines) {
  for (const line of lines) {
    const merchant = line.match(/^(?:merchant|store|shop)\s*[:\-]\s*(.{2,80})$/i);
    if (merchant) return merchant[1].trim().slice(0, 200);
  }
  const ignored = /\b(invoice|receipt|tax\s*invoice|bill\s*no|invoice\s*no|gstin|phone|mobile|email|address|customer|cashier|date|total|amount|subtotal|tax|gst|qty|quantity|price|payment|upi|cash|card|www\.|https?:)\b|दिनांक|कुल|राशि/i;
  return lines.map(line => line.trim().replace(/^[*#|:.,\s-]+|[*#|:.,\s-]+$/g, ''))
    .find(line => line.length >= 3 && line.length <= 80 && !ignored.test(line) && !/^\d[\d\s/-]*$/.test(line))
    ?.slice(0, 200) || '';
}

export function parseReceiptText(ocrText, paymentModes = []) {
  const text = normalizeDigits(String(ocrText || ''));
  const lines = text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return {
    amount: extractAmount(lines),
    date: extractDate(lines),
    description: extractDescription(lines),
    paymentMode: extractPaymentMode(text, paymentModes)
  };
}
