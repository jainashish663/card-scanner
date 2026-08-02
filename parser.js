// Heuristic extraction of firm name, person name, mobile number(s) and address
// from raw OCR text off a (typically Indian) visiting card. Best-effort only —
// the UI always shows the results in an editable form.

const FIRM_KEYWORDS = /\b(pvt\.?\s*ltd|private\s+limited|\bllp\b|\bltd\b|industries|enterprises?|traders?|jewell?ers?|jewels?|exports?|impex|agency|agencies|associates|stores?|company|\bco\.?\b|corporation|\bcorp\b|group|solutions|technologies|textiles|creations|international|overseas)\b/i;

const PHONE_LABEL = /\b(mob(?:ile)?|cell|ph(?:one)?|tel(?:ephone)?|contact|call|whats\s*app)\b\s*[:\-]?/i;

const DESIGNATION_KEYWORDS = /\b(proprietor|director|manager|partner|founder|owner|ceo|md|managing\s+director|president|chairman|executive|sales|marketing|head|incharge|in-charge)\b/i;

const NAME_TITLE = /^(mr|mrs|ms|miss|dr|shri|smt|er|adv|cs|ca)\.?\s+/i;

const ADDRESS_KEYWORDS = /\b(road|rd\.?|street|st\.?|marg|nagar|chowk|colony|sector|floor|fl\.?|building|bldg|opp\.?|opposite|near|city|dist(?:rict)?|tal(?:uka)?|state|pin\s*code|po\s*box|plot|shop\s*no|gala\s*no|lane|society|apartment|apt\.?|complex|market|chamber|estate)\b/i;

const INDIAN_STATES = /\b(maharashtra|gujarat|rajasthan|delhi|karnataka|tamil\s*nadu|kerala|telangana|andhra\s*pradesh|west\s*bengal|punjab|haryana|madhya\s*pradesh|uttar\s*pradesh|bihar|odisha|assam|goa|jharkhand|chhattisgarh|uttarakhand|himachal\s*pradesh|mumbai|pune|surat|jaipur|ahmedabad|bangalore|bengaluru|chennai|kolkata|hyderabad)\b/i;

function splitLines(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function extractMobileNumbers(text) {
  const lines = splitLines(text);
  const found = [];

  const pushIfValid = (raw) => {
    const digits = raw.replace(/\D/g, '');
    let d = digits;
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10 && /^[6-9]/.test(d)) {
      const formatted = d.slice(0, 5) + ' ' + d.slice(5);
      if (!found.includes(formatted)) found.push(formatted);
      return true;
    }
    return false;
  };

  // Pass 1: lines explicitly labeled as phone/mobile/contact
  for (const line of lines) {
    if (PHONE_LABEL.test(line)) {
      const matches = line.match(/[\d+][\d\s\-()]{7,}\d/g) || [];
      matches.forEach(pushIfValid);
    }
  }

  // Pass 2: fallback — any 10-digit run starting 6-9 anywhere in the text
  if (found.length === 0) {
    const matches = text.match(/(?:\+?91[\s\-]?)?[6-9]\d{9}\b/g) || [];
    matches.forEach(pushIfValid);
  }

  return found;
}

function extractAddress(text, usedLines) {
  const lines = splitLines(text);
  const picked = [];
  for (const line of lines) {
    if (usedLines.has(line)) continue;
    const hasPin = /\b\d{6}\b/.test(line);
    const isAddressy = ADDRESS_KEYWORDS.test(line) || INDIAN_STATES.test(line) || hasPin;
    // avoid picking up pure phone/email lines
    const looksLikePhoneOnly = PHONE_LABEL.test(line) && !ADDRESS_KEYWORDS.test(line);
    const looksLikeEmail = /@/.test(line);
    if (isAddressy && !looksLikePhoneOnly && !looksLikeEmail) {
      picked.push(line.replace(/,\s*$/, ''));
      usedLines.add(line);
    }
  }
  return picked.join(', ');
}

function extractFirmName(text, usedLines) {
  const lines = splitLines(text);

  // Prefer a line with a company-type keyword
  for (const line of lines) {
    if (usedLines.has(line)) continue;
    if (FIRM_KEYWORDS.test(line) && line.length <= 60 && !/\d{4,}/.test(line)) {
      usedLines.add(line);
      return line;
    }
  }

  // Fallback: first strong ALL-CAPS line (letters only, ignoring short words) near the top
  for (const line of lines.slice(0, 5)) {
    if (usedLines.has(line)) continue;
    const letters = line.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 4 && line === line.toUpperCase() && !/\d{4,}/.test(line) && !ADDRESS_KEYWORDS.test(line)) {
      usedLines.add(line);
      return line;
    }
  }

  return '';
}

function extractPersonName(text, usedLines) {
  const lines = splitLines(text);

  // Prefer a line with an explicit title (Mr./Dr./Shri etc.)
  for (const line of lines) {
    if (usedLines.has(line)) continue;
    if (NAME_TITLE.test(line) && line.length <= 40) {
      usedLines.add(line);
      return line.replace(NAME_TITLE, '').trim();
    }
  }

  // Line immediately above a designation keyword (Proprietor, Director, etc.)
  for (let i = 0; i < lines.length; i++) {
    if (DESIGNATION_KEYWORDS.test(lines[i]) && i > 0) {
      const candidate = lines[i - 1];
      if (!usedLines.has(candidate) && isNameLike(candidate)) {
        usedLines.add(candidate);
        return candidate;
      }
    }
  }

  // Fallback: first Title-Case, 2-4 word line with no digits, not the firm line
  for (const line of lines) {
    if (usedLines.has(line)) continue;
    if (isNameLike(line)) {
      usedLines.add(line);
      return line;
    }
  }

  return '';
}

function isNameLike(line) {
  if (!line || line.length > 40) return false;
  if (/\d/.test(line)) return false;
  if (FIRM_KEYWORDS.test(line)) return false;
  if (ADDRESS_KEYWORDS.test(line) || INDIAN_STATES.test(line)) return false;
  if (/@/.test(line)) return false;
  const words = line.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const titleCaseWords = words.filter(w => /^[A-Z][a-zA-Z.]*$/.test(w));
  return titleCaseWords.length >= Math.ceil(words.length * 0.6);
}

function parseCardText(frontText, backText) {
  const combined = [frontText || '', backText || ''].filter(Boolean).join('\n');
  const usedLines = new Set();

  const mobiles = extractMobileNumbers(combined);
  // mark mobile-bearing lines as used so they don't leak into address/name
  splitLines(combined).forEach(line => {
    if (PHONE_LABEL.test(line) || mobiles.some(m => line.replace(/\D/g, '').includes(m.replace(/\D/g, '')))) {
      usedLines.add(line);
    }
  });

  const firmName = extractFirmName(combined, usedLines);
  const personName = extractPersonName(combined, usedLines);
  const address = extractAddress(combined, usedLines);

  return {
    firmName,
    personName,
    mobile: mobiles.join(' / '),
    address,
    rawText: combined.trim(),
  };
}
