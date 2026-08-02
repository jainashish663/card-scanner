// Heuristic extraction of firm name, person name, mobile number(s) and address
// from raw OCR text off a (typically Indian) visiting card. Best-effort only —
// the UI always shows the results in an editable form.

const FIRM_KEYWORDS = /\b(pvt\.?\s*ltd|private\s+limited|\bllp\b|\bltd\b|industries|enterprises?|traders?|jewell?ers?|jewels?|exports?|impex|agency|agencies|associates|stores?|company|\bco\.?\b|corporation|\bcorp\b|group|solutions|technologies|textiles|creations|international|overseas)\b/i;

const PHONE_LABEL = /\b(mob(?:ile)?|cell|ph(?:one)?|tel(?:ephone)?|contact|call|whats\s*app)\b\s*[:\-]?/i;

const DESIGNATION_KEYWORDS = /\b(proprietor|director|manager|partner|founder|owner|ceo|md|managing\s+director|president|chairman|executive|sales|marketing|head|incharge|in-charge)\b/i;

const NAME_TITLE = /^(mr|mrs|ms|miss|dr|shri|smt|er|adv|cs|ca)\.?\s+/i;

// Words that show up in taglines and trade descriptions but never in a
// person's name. A line containing any of these is not a name — without this
// a tagline like "SPECIALIST FOR CZ LIGHT WEIGHT JEWELLERY" can be mistaken
// for a row of several people and sliced into fragments.
const DESCRIPTOR_WORDS = /\b(specialists?|manufacturers?|dealers?|wholesalers?|retailers?|suppliers?|exporters?|importers?|stockists?|distributors?|jewell?ery|jewell?ry|ornaments?|designs?|designer|collections?|quality|light|weight|gold|silver|diamond|platinum|antique|bridal|fancy|assorted|items?|types?|kinds?|varieties|for|and)\b/i;

const ADDRESS_KEYWORDS = /\b(road|rd\.?|street|st\.?|marg|nagar|chowk|colony|sector|floor|fl\.?|building|bldg|opp\.?|opposite|near|city|dist(?:rict)?|tal(?:uka)?|state|pin\s*code|po\s*box|plot|shop\s*no|gala\s*no|lane|society|apartment|apt\.?|complex|market|chamber|estate)\b/i;

const INDIAN_STATES = /\b(maharashtra|gujarat|rajasthan|delhi|karnataka|tamil\s*nadu|kerala|telangana|andhra\s*pradesh|west\s*bengal|punjab|haryana|madhya\s*pradesh|uttar\s*pradesh|bihar|odisha|assam|goa|jharkhand|chhattisgarh|uttarakhand|himachal\s*pradesh|mumbai|pune|surat|jaipur|ahmedabad|bangalore|bengaluru|chennai|kolkata|hyderabad)\b/i;

function splitLines(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Underscores survive here, unlike splitLines — Instagram handles need them.
function splitRawLines(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
}

const KNOWN_TLDS = ['com', 'in', 'co', 'net', 'org', 'io', 'info', 'biz', 'edu', 'gov', 'us', 'uk', 'ca', 'au', 'ai', 'me'];

// OCR routinely mangles addresses: it drops the dot in "gmail.com" and slips
// spaces into the local part ("jain.arvind1 970@..."). Repair both sides of
// the @ before validating. Merging trailing words back into the domain is
// capped and only accepted once it ends in a real TLD — otherwise a line
// like "Follow us @shree.nakoda for new arrivals" (an Instagram mention, not
// an email) would swallow the rest of the sentence as a fake domain.
function extractEmail(text) {
  for (const line of splitRawLines(text)) {
    if (!line.includes('@')) continue;
    const stripped = line.replace(/^e[\s\-]*mail\s*[:\-]?\s*/i, '');
    const at = stripped.indexOf('@');
    if (at < 0) continue;

    let local = stripped.slice(0, at).replace(/\s+/g, '');
    const localParts = local.split(/[^A-Za-z0-9._%+-]/).filter(Boolean);
    local = localParts.length ? localParts[localParts.length - 1] : '';
    if (!local) continue;

    const afterAt = stripped.slice(at + 1).replace(/\s*\.\s*/g, '.'); // "gmail . com" -> "gmail.com"
    const words = afterAt.split(/\s+/).filter(Boolean);

    let domain = null;
    for (let take = 1; take <= Math.min(4, words.length); take++) {
      const chunk = words.slice(0, take).join('.').replace(/[.,;:'"]+$/, '');
      const tld = (chunk.split('.').pop() || '').toLowerCase();
      if (KNOWN_TLDS.includes(tld) && /^[A-Za-z0-9.-]+$/.test(chunk)) {
        domain = chunk; // keep the longest valid match, e.g. "yahoo.co.in" over "yahoo.co"
      }
    }
    if (!domain) continue;

    const candidate = `${local}@${domain}`.toLowerCase();
    if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

// Handles can't contain spaces, so a space inside one is an OCR misread of
// an underscore ("shree Nakoda_Jewels" -> "shree_Nakoda_Jewels").
function extractInstagram(text) {
  const LABEL = /\b(instagram|insta|ig)\b\s*[:\-@]?\s*/i;
  for (const line of splitRawLines(text)) {
    if (!LABEL.test(line)) continue;
    let handle = line.replace(new RegExp('^.*?' + LABEL.source, 'i'), '');
    handle = handle
      .replace(/^[@\s:\-]+/, '')
      .replace(/["'`.,;]+$/, '')
      .trim()
      .replace(/\s+/g, '_');
    if (/^[A-Za-z0-9._]{2,40}$/.test(handle)) return handle;
  }

  // No label — fall back to a bare @handle that isn't an email address.
  for (const line of splitRawLines(text)) {
    if (line.includes('@') && /\.[A-Za-z]{2,}/.test(line)) continue; // looks like an email
    const m = line.match(/(?:^|\s)@([A-Za-z0-9._]{2,40})\b/);
    if (m) return m[1];
  }
  return '';
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

// Returns an array of names: usually a single entry, but more than one when
// several people sharing the card were detected on one merged OCR row.
function extractPersonNames(text, usedLines, mobileCount) {
  const lines = splitLines(text);

  // Multiple people sharing one card (e.g. "ARVIND JAIN AKHIL J. JAIN
  // JITENDRA JAIN") often get OCR'd as one merged row when their columns
  // sit on the same horizontal band. Try splitting such a row first —
  // otherwise the single-name checks below would just reject it. This runs
  // regardless of how many numbers were found, since a misread number
  // shouldn't cost us the names.
  for (const line of lines) {
    if (usedLines.has(line)) continue;
    if (isMultiNameLike(line)) {
      const names = splitMultiName(line, mobileCount);
      if (names && names.length > 1) {
        usedLines.add(line);
        return names;
      }
    }
  }

  // The same people may instead come through as one name per line, when OCR
  // reads the columns top-to-bottom rather than across. Only gather several
  // when the card carries more than one number — on a single-contact card an
  // extra name-like line is more likely a tagline than a second person.
  if (mobileCount > 1) {
    const collected = [];
    for (const line of lines) {
      if (usedLines.has(line)) continue;
      if (isNameLike(line)) collected.push(line);
    }
    if (collected.length > 1) {
      collected.forEach(l => usedLines.add(l));
      return collected;
    }
  }

  // Prefer a line with an explicit title (Mr./Dr./Shri etc.)
  for (const line of lines) {
    if (usedLines.has(line)) continue;
    if (NAME_TITLE.test(line) && line.length <= 40) {
      usedLines.add(line);
      return [line.replace(NAME_TITLE, '').trim()];
    }
  }

  // Line immediately above a designation keyword (Proprietor, Director, etc.)
  for (let i = 0; i < lines.length; i++) {
    if (DESIGNATION_KEYWORDS.test(lines[i]) && i > 0) {
      const candidate = lines[i - 1];
      if (!usedLines.has(candidate) && isNameLike(candidate)) {
        usedLines.add(candidate);
        return [candidate];
      }
    }
  }

  // Fallback: first Title-Case, 2-4 word line with no digits, not the firm line
  for (const line of lines) {
    if (usedLines.has(line)) continue;
    if (isNameLike(line)) {
      usedLines.add(line);
      return [line];
    }
  }

  return [];
}

function isNameLike(line) {
  if (!line || line.length > 40) return false;
  if (/\d/.test(line)) return false;
  if (FIRM_KEYWORDS.test(line)) return false;
  if (DESCRIPTOR_WORDS.test(line)) return false;
  if (ADDRESS_KEYWORDS.test(line) || INDIAN_STATES.test(line)) return false;
  if (/@/.test(line)) return false;
  const words = line.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const titleCaseWords = words.filter(w => /^[A-Z][a-zA-Z.]*$/.test(w));
  return titleCaseWords.length >= Math.ceil(words.length * 0.6);
}

function isMultiNameLike(line) {
  if (!line || line.length > 100) return false;
  if (/\d/.test(line)) return false;
  if (FIRM_KEYWORDS.test(line)) return false;
  if (DESCRIPTOR_WORDS.test(line)) return false;
  if (ADDRESS_KEYWORDS.test(line) || INDIAN_STATES.test(line)) return false;
  if (/@/.test(line)) return false;
  const words = line.split(' ').filter(Boolean);
  // 4 words is the smallest possible two-person row ("ARVIND JAIN JITENDRA
  // JAIN"). Rows this short are also valid single names, so splitMultiName
  // only accepts them when a repeated surname clearly marks the boundary.
  if (words.length < 4) return false;
  const titleCaseWords = words.filter(w => /^[A-Z][a-zA-Z.]*$/.test(w));
  return titleCaseWords.length >= Math.ceil(words.length * 0.7);
}

// Splits a merged multi-person row into individual names. `count` is the
// number of mobile numbers found, used as a hint for the expected number of
// people. A single-letter initial (e.g. "J.") is glued to the following word
// so "AKHIL J. JAIN" isn't cut in half.
//
// Two strategies, in order:
//  1. Shared-surname split — on these cards the family/surname usually
//     repeats once per person ("ARVIND JAIN | AKHIL J. JAIN | JITENDRA
//     JAIN"), so cutting after each occurrence recovers the names even when
//     they don't all have the same word count.
//  2. Even division — fall back to slicing into `count` equal groups.
function splitMultiName(line, count) {
  const tokens = line.split(' ').filter(Boolean);
  const merged = [];
  for (let i = 0; i < tokens.length; i++) {
    if (/^[A-Z]\.$/.test(tokens[i]) && i + 1 < tokens.length) {
      merged.push(tokens[i] + ' ' + tokens[i + 1]);
      i++;
    } else {
      merged.push(tokens[i]);
    }
  }
  if (merged.length < 4) return null;

  const bySurname = splitBySharedSurname(merged);
  if (bySurname && bySurname.length >= 2) return bySurname;

  // Even division is a weaker signal than a repeated surname, so only accept
  // it when every resulting group still reads like a name on its own.
  if (count >= 2 && merged.length >= count * 2 && merged.length % count === 0) {
    const groupSize = merged.length / count;
    const names = [];
    for (let i = 0; i < merged.length; i += groupSize) {
      names.push(merged.slice(i, i + groupSize).join(' '));
    }
    if (names.every(isNameLike)) return names;
  }

  return null;
}

// Finds a surname that repeats at least twice and always sits at a name
// boundary, then splits after each occurrence. Matching is done on the last
// word of each token, since initial-gluing can leave a token like "J. JAIN"
// that still ends the name it belongs to.
function splitBySharedSurname(tokens) {
  const lastWord = (t) => {
    const parts = t.toUpperCase().split(' ').filter(Boolean);
    return parts[parts.length - 1] || '';
  };

  const counts = {};
  tokens.forEach(t => {
    const key = lastWord(t);
    counts[key] = (counts[key] || 0) + 1;
  });

  let surname = null;
  let best = 1;
  Object.keys(counts).forEach(key => {
    if (counts[key] > best) {
      best = counts[key];
      surname = key;
    }
  });
  if (!surname || best < 2) return null;

  // The final token must end with the surname, otherwise this isn't a clean
  // "<given> <surname>" repetition and splitting would truncate a name.
  if (lastWord(tokens[tokens.length - 1]) !== surname) return null;

  const names = [];
  let current = [];
  for (const token of tokens) {
    current.push(token);
    if (lastWord(token) === surname) {
      names.push(current.join(' '));
      current = [];
    }
  }
  if (current.length) return null; // trailing leftovers — too ambiguous
  return names.filter(n => n.split(' ').length >= 2);
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

  // Pulled from the raw text before line-normalisation, and marked used so
  // they can't be mistaken for names or address lines.
  const email = extractEmail(combined);
  const instagram = extractInstagram(combined);
  splitLines(combined).forEach(line => {
    if (/@/.test(line) || /\b(instagram|insta|ig)\b/i.test(line)) usedLines.add(line);
  });

  const firmName = extractFirmName(combined, usedLines);
  const names = extractPersonNames(combined, usedLines, mobiles.length);
  const address = extractAddress(combined, usedLines);

  // One contact row per person, so each becomes its own saved card. With
  // several people the rows are paired up in reading order and never merged
  // — an unpaired name or number is easier to fix in an otherwise-correct
  // row than to untangle from a combined blob. With at most one name, extra
  // numbers are treated as that one person's alternates rather than as
  // separate people.
  const contacts = [];
  if (names.length > 1) {
    const rowCount = Math.max(names.length, mobiles.length);
    for (let i = 0; i < rowCount; i++) {
      contacts.push({ name: names[i] || '', mobile: mobiles[i] || '' });
    }
  } else {
    contacts.push({ name: names[0] || '', mobile: mobiles.join(' / ') });
  }

  return {
    firmName,
    personName: names.join(', '),
    mobile: mobiles.join(' / '),
    address,
    email,
    instagram,
    contacts,
    rawText: combined.trim(),
  };
}
