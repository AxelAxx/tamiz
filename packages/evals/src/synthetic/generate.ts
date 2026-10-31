/**
 * The held-out PII datasets (spec 007 FR-009, research R-05, contracts/datasets.md).
 *
 * - `pii-leak-es`: request-shaped cases (chat, summarize, extract, translate, code; single
 *   and multi-message; health, legal, fintech, HR) whose annotated values must never reach
 *   a non-local provider verbatim.
 * - `pii-detection-es`: sentences with annotated spans in harder formats (lower-case control
 *   letters, separators, values at sentence edges, adjacent values), plus look-alike
 *   negatives with broken control characters.
 *
 * Deterministic: the same seed gives the same bytes, which `--check` verifies in CI.
 */
import type { PrivacyEntityKindDto } from "@tamiz/contracts";
import { dniLetter, type Identifiers, identifiers } from "./identifiers.js";
import { city, email, person } from "./names.js";
import { type Random, seeded } from "./random.js";

export const SEED = 20_261_031;
const GENERATOR = "packages/evals/src/synthetic/generate.ts";
const NOTE =
  "Synthetic cases only. Every name, number and text is invented by the generator; " +
  "identifiers carry valid control characters so recognizers treat them as real-looking.";

type Kind = PrivacyEntityKindDto;
interface Span {
  readonly kind: Kind;
  readonly start: number;
  readonly end: number;
}

/** Builds a text piece by piece, recording the spans of the annotated values. */
class Text {
  private readonly pieces: string[] = [];
  readonly spans: Span[] = [];

  t(text: string): this {
    this.pieces.push(text);
    return this;
  }

  e(kind: Kind, value: string): this {
    const start = this.pieces.join("").length;
    this.pieces.push(value);
    this.spans.push({ kind, start, end: start + value.length });
    return this;
  }

  get text(): string {
    return this.pieces.join("");
  }
}

interface Gen {
  readonly r: Random;
  readonly id: Identifiers;
}

// --- detection ------------------------------------------------------------------------------

type DetectionTemplate = (g: Gen) => { text: Text; tags: string[] };

const DETECTION: ReadonlyArray<DetectionTemplate> = [
  (g) => ({
    text: new Text()
      .e("PERSON", person(g.r))
      .t(", con DNI ")
      .e("DNI", g.id.dni())
      .t(", ingresa en planta el lunes."),
    tags: ["clinic", "sentence-start"],
  }),
  (g) => ({
    text: new Text()
      .t("Paciente: ")
      .e("PERSON", person(g.r))
      .t(". Afiliación ")
      .e("NSS", g.id.nss())
      .t(". Centro de salud de ")
      .e("LOCATION", city(g.r))
      .t("."),
    tags: ["clinic"],
  }),
  (g) => {
    const name = person(g.r);
    return {
      text: new Text()
        .t("Contactar con la familia en el ")
        .e("PHONE", g.id.phone())
        .t(" o en ")
        .e("EMAIL", email(g.r, name)),
      tags: ["clinic", "sentence-end"],
    };
  },
  (g) => ({
    text: new Text()
      .t("Alta en nómina de ")
      .e("PERSON", person(g.r))
      .t(" (NIE ")
      .e("NIE", g.id.nie())
      .t("); cuenta ")
      .e("IBAN", g.id.iban())
      .t("."),
    tags: ["hr"],
  }),
  (g) => ({
    text: new Text()
      .t("El trabajador con número de afiliación ")
      .e("NSS", g.id.nss())
      .t(" solicita el cambio de cuenta a ")
      .e("IBAN", g.id.iban()),
    tags: ["hr", "sentence-end"],
  }),
  (g) => ({
    text: new Text()
      .t("La sociedad ")
      .e("CIF", g.id.cif())
      .t(" y ")
      .e("PERSON", person(g.r))
      .t(", vecino de ")
      .e("LOCATION", city(g.r))
      .t(", firman el acuerdo."),
    tags: ["legal"],
  }),
  (g) => ({
    text: new Text()
      .t("Notifíquese a ")
      .e("EMAIL", email(g.r, person(g.r)))
      .t("; teléfono de contacto ")
      .e("PHONE", g.id.phone())
      .t("."),
    tags: ["legal"],
  }),
  (g) => ({
    text: new Text()
      .t("Cargo rechazado en la tarjeta ")
      .e("CREDIT_CARD", g.id.card())
      .t(" del titular ")
      .e("PERSON", person(g.r))
      .t("."),
    tags: ["fintech"],
  }),
  (g) => ({ text: new Text().t("IBAN:").e("IBAN", g.id.iban()), tags: ["fintech", "adjacent"] }),
  (g) => ({
    text: new Text().t("Devolución a ").e("IBAN", g.id.iban()).t(" por importe de 120,50 euros."),
    tags: ["fintech"],
  }),
  (g) => ({
    text: new Text().t("DNI ").e("DNI", g.id.dni()).t(", NIE ").e("NIE", g.id.nie()).t("."),
    tags: ["generic", "adjacent"],
  }),
  (g) => ({
    text: new Text().e("DNI", g.id.dni()).t(" es el documento aportado."),
    tags: ["generic", "sentence-start"],
  }),
  (g) => ({
    text: new Text()
      .t("Le escribe ")
      .e("PERSON", person(g.r))
      .t(" desde la oficina de ")
      .e("LOCATION", city(g.r))
      .t("; mi móvil es el ")
      .e("PHONE", g.id.phone())
      .t("."),
    tags: ["hr"],
  }),
  (g) => ({
    text: new Text()
      .t("Escritura otorgada por ")
      .e("PERSON", person(g.r))
      .t(" ante notario en ")
      .e("LOCATION", city(g.r))
      .t(" el 3 de marzo."),
    tags: ["legal"],
  }),
  (g) => ({
    text: new Text()
      .t("Pago con ")
      .e("CREDIT_CARD", g.id.card())
      .t(", confirmación enviada a ")
      .e("EMAIL", email(g.r, person(g.r)))
      .t("."),
    tags: ["fintech"],
  }),
  (g) => ({
    text: new Text()
      .t("Factura emitida a ")
      .e("CIF", g.id.cif())
      .t(", domicilio fiscal en ")
      .e("LOCATION", city(g.r))
      .t("."),
    tags: ["fintech"],
  }),
  (g) => ({
    text: new Text()
      .e("NIE", g.id.nie())
      .t(" es el documento de la nueva contratada, ")
      .e("PERSON", person(g.r))
      .t("."),
    tags: ["hr", "sentence-start"],
  }),
  (g) => ({
    text: new Text().t("Afiliado ").e("NSS", g.id.nss()).t(" (").e("CIF", g.id.cif()).t(")"),
    tags: ["hr", "adjacent", "sentence-end"],
  }),
  (g) => ({
    text: new Text()
      .t("Remitir el informe a ")
      .e("EMAIL", email(g.r, person(g.r)))
      .t(" y llamar al ")
      .e("PHONE", g.id.phone()),
    tags: ["clinic", "sentence-end"],
  }),
  (g) => ({
    text: new Text().t("Tarjeta ").e("CREDIT_CARD", g.id.card()).t(" bloqueada por seguridad."),
    tags: ["fintech"],
  }),
];

/** Look-alikes with broken control characters or the wrong shape: nothing to find. */
function negative(g: Gen): Text {
  const n = g.r.int(100_000_000);
  const wrong = [..."TRWAGMYFPDXBNJZSQVHLCKE"].filter((c) => c !== dniLetter(n));
  switch (g.r.int(4)) {
    case 0:
      return new Text().t(
        `Documento ${String(n).padStart(8, "0")}${g.r.pick(wrong)} pendiente de revisión.`,
      );
    case 1:
      return new Text().t(`Pedido ${g.r.digits(8)} enviado al almacén ${g.r.between(1, 9)}.`);
    case 2:
      return new Text().t(
        `El expediente 2026/${g.r.digits(4)} sigue abierto y la sala ${g.r.between(1, 30)} está libre.`,
      );
    default:
      return new Text().t(
        `Referencia interna ${g.r.between(1, 5)}${g.r.digits(8)} sin incidencias.`,
      );
  }
}

// --- leak -----------------------------------------------------------------------------------

interface Message {
  readonly role: "system" | "user" | "assistant";
  readonly text: Text;
}
type LeakTemplate = (g: Gen) => { messages: Message[]; tags: string[] };

const user = (text: Text): Message => ({ role: "user", text });
const LEAK: ReadonlyArray<LeakTemplate> = [
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Resume el alta de ")
          .e("PERSON", person(g.r))
          .t(" (DNI ")
          .e("DNI", g.id.dni())
          .t(") para el informe del hospital de ")
          .e("LOCATION", city(g.r))
          .t("."),
      ),
    ],
    tags: ["clinic", "summarize"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Extrae los datos bancarios de esta nómina: titular ")
          .e("PERSON", person(g.r))
          .t(", IBAN ")
          .e("IBAN", g.id.iban())
          .t(", NSS ")
          .e("NSS", g.id.nss())
          .t("."),
      ),
    ],
    tags: ["hr", "extract"],
  }),
  (g) => ({
    messages: [
      {
        role: "system",
        text: new Text().t("Eres un asistente de atención al cliente de un banco."),
      },
      user(
        new Text()
          .t("Hola, soy ")
          .e("PERSON", person(g.r))
          .t(" y mi tarjeta ")
          .e("CREDIT_CARD", g.id.card())
          .t(" ha sido rechazada. ¿Qué hago?"),
      ),
    ],
    tags: ["fintech", "chat"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Traduce al inglés: el señor ")
          .e("PERSON", person(g.r))
          .t(", con NIE ")
          .e("NIE", g.id.nie())
          .t(", reside en ")
          .e("LOCATION", city(g.r))
          .t("."),
      ),
    ],
    tags: ["legal", "translate"],
  }),
  (g) => ({
    messages: [
      user(new Text().t("Necesito ayuda para revisar un contrato.")),
      { role: "assistant", text: new Text().t("Claro, pásame la cláusula que quieres revisar.") },
      user(
        new Text()
          .t("Aquí va: la empresa ")
          .e("CIF", g.id.cif())
          .t(" contrata a ")
          .e("PERSON", person(g.r))
          .t(", con DNI ")
          .e("DNI", g.id.dni())
          .t(", desde el 1 de enero."),
      ),
    ],
    tags: ["legal", "multi-message"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Resume esta notificación: se cita a ")
          .e("PERSON", person(g.r))
          .t(" en el juzgado de ")
          .e("LOCATION", city(g.r))
          .t("; contacto ")
          .e("EMAIL", email(g.r, person(g.r)))
          .t(", teléfono ")
          .e("PHONE", g.id.phone())
          .t("."),
      ),
    ],
    tags: ["legal", "summarize"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Clasifica esta incidencia: transferencia fallida desde ")
          .e("IBAN", g.id.iban())
          .t(" del cliente ")
          .e("EMAIL", email(g.r, person(g.r)))
          .t("."),
      ),
    ],
    tags: ["fintech", "classify"],
  }),
  (g) => ({
    messages: [
      user(
        new Text().t("Escribe una función en Python que valide este DNI: ").e("DNI", g.id.dni()),
      ),
    ],
    tags: ["generic", "code"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Mi compañera ")
          .e("PERSON", person(g.r))
          .t(" me ha pasado su móvil, ")
          .e("PHONE", g.id.phone())
          .t(". ¿Puedes redactar un mensaje de bienvenida?"),
      ),
    ],
    tags: ["hr", "chat"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Del siguiente texto extrae la fecha y el motivo: paciente ")
          .e("PERSON", person(g.r))
          .t(", afiliación ")
          .e("NSS", g.id.nss())
          .t(", acude el 12 de mayo por dolor lumbar."),
      ),
    ],
    tags: ["clinic", "extract"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Resume la actividad de la sociedad ")
          .e("CIF", g.id.cif())
          .t(" en ")
          .e("LOCATION", city(g.r))
          .t(" durante el último trimestre."),
      ),
    ],
    tags: ["fintech", "summarize", "low-only"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Redacta una respuesta breve para ")
          .e("EMAIL", email(g.r, person(g.r)))
          .t(" confirmando la cita del jueves."),
      ),
    ],
    tags: ["clinic", "chat"],
  }),
  (g) => ({
    messages: [
      { role: "system", text: new Text().t("Responde siempre en español y de forma breve.") },
      user(new Text().t("¿Este NIE tiene buen formato? ").e("NIE", g.id.nie())),
    ],
    tags: ["generic", "chat"],
  }),
  (g) => ({
    messages: [
      user(new Text().t("Te paso los datos para el reembolso.")),
      { role: "assistant", text: new Text().t("De acuerdo, ¿a qué cuenta lo ingresamos?") },
      user(
        new Text()
          .t("A la ")
          .e("IBAN", g.id.iban())
          .t(", a nombre de ")
          .e("PERSON", person(g.r))
          .t("."),
      ),
    ],
    tags: ["fintech", "multi-message"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("Prepara un resumen del expediente laboral: ")
          .e("PERSON", person(g.r))
          .t(", DNI ")
          .e("DNI", g.id.dni())
          .t(", NSS ")
          .e("NSS", g.id.nss())
          .t(", cuenta ")
          .e("IBAN", g.id.iban())
          .t(", móvil ")
          .e("PHONE", g.id.phone())
          .t("."),
      ),
    ],
    tags: ["hr", "summarize"],
  }),
  (g) => ({
    messages: [
      user(
        new Text()
          .t("El cliente pagó con ")
          .e("CREDIT_CARD", g.id.card())
          .t(" y pide la factura a ")
          .e("EMAIL", email(g.r, person(g.r)))
          .t(". Redacta el correo."),
      ),
    ],
    tags: ["fintech", "chat"],
  }),
];

// --- output ---------------------------------------------------------------------------------

export const LEAK_CASES = 160;
export const DETECTION_CASES = 140;
export const DETECTION_NEGATIVES = 20;

function header(dataset: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    dataset,
    version: 1,
    synthetic: true,
    language: ["es"],
    generator: GENERATOR,
    seed: SEED,
    ...extra,
    note: NOTE,
  });
}

const pad = (n: number) => String(n).padStart(4, "0");

export function generateLeak(seed = SEED): string {
  const g = { r: seeded(seed), id: identifiers(seeded(seed + 1)) };
  const lines = [header("pii-leak-es", { policy: "apps/gateway/policies/default.yaml" })];
  for (let i = 0; i < LEAK_CASES; i += 1) {
    const template = LEAK[i % LEAK.length];
    if (template === undefined) throw new Error("no template");
    const { messages, tags } = template(g);
    lines.push(
      JSON.stringify({
        id: `pii-leak-${pad(i + 1)}`,
        model: "tamiz-auto",
        tags,
        messages: messages.map((m) => ({ role: m.role, content: m.text.text })),
        values: messages.flatMap((m, messageIndex) =>
          m.text.spans.map((s) => ({ ...s, messageIndex })),
        ),
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function generateDetection(seed = SEED): string {
  const g = { r: seeded(seed + 2), id: identifiers(seeded(seed + 3)) };
  const lines = [header("pii-detection-es")];
  const total = DETECTION_CASES + DETECTION_NEGATIVES;
  for (let i = 0; i < total; i += 1) {
    // Every eighth case is a negative, so they spread over the file.
    const isNegative = i % 8 === 7 && i < DETECTION_NEGATIVES * 8;
    const item = isNegative
      ? { text: negative(g), tags: ["negative"] }
      : (DETECTION[g.r.int(DETECTION.length)] ?? DETECTION[0])?.(g);
    if (item === undefined) throw new Error("no template");
    lines.push(
      JSON.stringify({
        id: `pii-detection-${pad(i + 1)}`,
        tags: item.tags,
        text: item.text.text,
        spans: item.text.spans,
      }),
    );
  }
  return `${lines.join("\n")}\n`;
}

export const GENERATED = {
  "pii-leak-es.v1.jsonl": generateLeak,
  "pii-detection-es.v1.jsonl": generateDetection,
} as const;
