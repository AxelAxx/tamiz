/**
 * Spanish identifiers with valid control characters (spec 007 research R-05), so that the
 * privacy service's checksum validation accepts them as real-looking values. Every number
 * is invented by the seeded PRNG; formats include the separators and letter cases found
 * in real documents.
 */
import type { Random } from "./random.js";

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_LETTERS = "JABCDEFGHI";

export function dniLetter(number: number): string {
  return DNI_LETTERS[number % 23] ?? "T";
}

export function cifControl(digits: string): number {
  let even = 0;
  let odd = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const d = Number(digits[i]);
    if (i % 2 === 1) even += d;
    else odd += Math.floor((2 * d) / 10) + ((2 * d) % 10);
  }
  return (10 - ((even + odd) % 10)) % 10;
}

export function accountControl(ten: string): string {
  const weights = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
  const sum = [...ten].reduce((total, d, i) => total + Number(d) * (weights[i] ?? 0), 0);
  const value = 11 - (sum % 11);
  return value === 11 ? "0" : value === 10 ? "1" : String(value);
}

/** ISO 13616 mod 97 over the letters-as-numbers string, without big integers. */
export function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

function asDigits(text: string): string {
  return [...text].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join("");
}

export function ibanCheck(country: string, bban: string): string {
  return String(98 - mod97(asDigits(`${bban}${country}00`))).padStart(2, "0");
}

export function ibanValid(iban: string): boolean {
  const compact = iban.replace(/\s/g, "").toUpperCase();
  return mod97(asDigits(compact.slice(4) + compact.slice(0, 4))) === 1;
}

export function nssControl(province: number, number: number): number {
  const base =
    number < 10_000_000
      ? number + province * 10_000_000
      : Number(`${province}${String(number).padStart(8, "0")}`);
  return base % 97;
}

export function luhnValid(digits: string): boolean {
  let total = 0;
  [...digits].reverse().forEach((ch, i) => {
    let n = Number(ch);
    if (i % 2 === 1) n *= 2;
    total += n > 9 ? n - 9 : n;
  });
  return total % 10 === 0;
}

function luhnComplete(body: string): string {
  for (let d = 0; d < 10; d += 1) if (luhnValid(`${body}${d}`)) return `${body}${d}`;
  throw new Error("unreachable");
}

export interface Identifiers {
  dni(): string;
  nie(): string;
  cif(): string;
  iban(): string;
  nss(): string;
  phone(): string;
  card(): string;
}

export function identifiers(r: Random): Identifiers {
  return {
    dni() {
      const n = r.int(100_000_000);
      const digits = String(n).padStart(8, "0");
      const letter = dniLetter(n);
      switch (r.int(5)) {
        case 0:
          return `${digits}${letter}`;
        case 1:
          return `${digits} ${letter.toLowerCase()}`;
        case 2:
          return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}-${letter}`;
        case 3:
          return `${digits}-${letter.toLowerCase()}`;
        default:
          return `${digits}${letter.toLowerCase()}`;
      }
    },
    nie() {
      const prefix = r.pick(["X", "Y", "Z"]);
      const n = r.int(10_000_000);
      const letter = dniLetter(["X", "Y", "Z"].indexOf(prefix) * 10_000_000 + n);
      const body = String(n).padStart(7, "0");
      switch (r.int(4)) {
        case 0:
          return `${prefix}${body}${letter}`;
        case 1:
          return `${prefix.toLowerCase()}${body}${letter.toLowerCase()}`;
        case 2:
          return `${prefix} ${body} ${letter}`;
        default:
          return `${prefix}.${body}.${letter}`;
      }
    },
    cif() {
      const org = r.pick(["A", "B", "B", "F", "G", "N", "P", "Q", "S", "U", "V"]);
      const digits = r.digits(7);
      const control = cifControl(digits);
      const mark = "NPQRSW".includes(org) ? (CIF_LETTERS[control] ?? "J") : String(control);
      switch (r.int(3)) {
        case 0:
          return `${org}${digits}${mark}`;
        case 1:
          return `${org}-${digits}-${mark}`;
        default:
          return `${org.toLowerCase()}${digits}${mark.toLowerCase()}`;
      }
    },
    iban() {
      const bankBranch = r.digits(8);
      const account = r.digits(10);
      const bban = `${bankBranch}${accountControl(`00${bankBranch}`)}${accountControl(account)}${account}`;
      const value = `ES${ibanCheck("ES", bban)}${bban}`;
      switch (r.int(3)) {
        case 0:
          return value.match(/.{1,4}/g)?.join(" ") ?? value;
        case 1:
          return value;
        default:
          return value.toLowerCase();
      }
    },
    nss() {
      const province = r.between(1, 52);
      const number = r.int(100_000_000);
      const control = nssControl(province, number);
      const sep = r.pick(["", "/", " ", "-"]);
      const p = String(province).padStart(2, "0");
      return `${p}${sep}${String(number).padStart(8, "0")}${sep}${String(control).padStart(2, "0")}`;
    },
    phone() {
      const first = r.pick(["6", "6", "6", "7", "8", "9"]);
      const second = first === "7" ? String(r.between(1, 4)) : String(r.int(10));
      const digits = `${first}${second}${r.digits(7)}`;
      const g3 = (sep: string) =>
        `${digits.slice(0, 3)}${sep}${digits.slice(3, 6)}${sep}${digits.slice(6)}`;
      switch (r.int(6)) {
        case 0:
          return digits;
        case 1:
          return g3(" ");
        case 2:
          return `${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 7)} ${digits.slice(7)}`;
        case 3:
          return `+34 ${g3(" ")}`;
        case 4:
          return g3(".");
        default:
          return `0034 ${digits}`;
      }
    },
    card() {
      const prefix = r.pick(["4", "51", "52", "53", "54", "55"]);
      const number = luhnComplete(`${prefix}${r.digits(15 - prefix.length)}`);
      const sep = r.pick([" ", "-", ""]);
      return sep === "" ? number : (number.match(/.{4}/g)?.join(sep) ?? number);
    },
  };
}
