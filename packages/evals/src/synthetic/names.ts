/**
 * Invented people and places for the held-out datasets (spec 007 research R-05). The lists
 * differ from the privacy service's development corpus (Faker `es_ES` names and its own
 * city list); a test checks that no name token here appears in that corpus.
 */
import type { Random } from "./random.js";

export const FIRST_NAMES = [
  "Edurne",
  "Ainhoa",
  "Maialen",
  "Covadonga",
  "Arantxa",
  "Remedios",
  "Inmaculada",
  "Begoña",
  "Leire",
  "Milagros",
  "Nerea",
  "Amaia",
  "Noelia",
  "Vanesa",
  "Iñaki",
  "Unai",
  "Gorka",
  "Xabier",
  "Baltasar",
  "Leandro",
  "Telmo",
  "Isidro",
  "Brais",
  "Valentín",
  "Nicanor",
  "Eusebio",
  "Casimiro",
  "Ismael",
  "Damián",
  "Anselmo",
] as const;

export const SURNAMES = [
  "Agirre",
  "Olaizola",
  "Lizarraga",
  "Zubiri",
  "Goikoetxea",
  "Arrieta",
  "Etxeberria",
  "Larrañaga",
  "Zabaleta",
  "Gorostiza",
  "Cifuentes",
  "Bermúdez",
  "Valcárcel",
  "Sotomayor",
  "Seoane",
  "Escudero",
  "Rosales",
  "Salcedo",
  "Toledano",
  "Uriarte",
  "Valverde",
  "Carballo",
  "Ballesteros",
  "Cordero",
  "Jurado",
  "Pacheco",
  "Aranguren",
  "Ibarra",
  "Mendizábal",
  "Sagasta",
] as const;

export const COMPOUND_SURNAMES = ["de la Fuente", "del Río", "de la Peña", "del Valle"] as const;

export const CITIES = [
  "Cuenca",
  "Soria",
  "Monforte de Lemos",
  "Huesca",
  "Lugo",
  "Ourense",
  "Ávila",
  "Segovia",
  "Zamora",
  "Palencia",
  "Ponferrada",
  "Jaén",
  "Huelva",
  "Cáceres",
  "Mérida",
  "Tarragona",
  "Lleida",
  "Girona",
  "Castellón",
  "Albacete",
  "Guadalajara",
  "Ciudad Real",
  "Talavera de la Reina",
] as const;

export function person(r: Random): string {
  const first = r.pick(FIRST_NAMES);
  switch (r.int(4)) {
    case 0:
      return `${first} ${r.pick(SURNAMES)}`;
    case 1:
      return `${first} ${r.pick(COMPOUND_SURNAMES)} ${r.pick(SURNAMES)}`;
    default:
      return `${first} ${r.pick(SURNAMES)} ${r.pick(SURNAMES)}`;
  }
}

function ascii(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function email(r: Random, name: string): string {
  const [first = "user", ...rest] = ascii(name).toLowerCase().split(" ");
  const last = rest.at(-1) ?? "x";
  const domain = r.pick(["example.com", "example.org", "correo.example.es", "example.net"]);
  switch (r.int(4)) {
    case 0:
      return `${first}.${last}@${domain}`;
    case 1:
      return `${first[0] ?? "u"}${last}${r.between(1, 99)}@${domain}`;
    case 2:
      return `${first}.${last}+rrhh@${domain}`;
    default:
      return `${first.toUpperCase()}.${last.toUpperCase()}@${domain.toUpperCase()}`;
  }
}

export function city(r: Random): string {
  return r.pick(CITIES);
}
