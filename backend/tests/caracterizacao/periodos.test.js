// Etapa 0.5: política temporal (src/lib/periodos.js), nível A (funções puras,
// sem HTTP). Datas "civis" são Date cujos componentes UTC são o relógio de
// Manaus; `civil(a, m, d, h, mi, s, ms)` monta uma. Ver
// docs/tcc/etapa-0-5-politica-temporal.md.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  civil,
  civilParaInstante,
  deslocarDiaISO,
  diaCivilISO,
  formatarDiaCivil,
  hojeCivilISO,
  intervaloDaSemana,
  intervaloDoDia,
  intervaloDoMes,
  intervaloEntreDatas,
  lerDataCivil,
  nomeDoMes,
  paraCivil,
  replacerJsonTemporal,
  rotuloMesAno,
  serializarCivil,
} from "../../src/lib/periodos.js";

const iso = (d) => d.toISOString(); // componentes civis, para comparar
/** O instante civil pertence ao intervalo semiaberto? */
const dentro = (d, { inicio, fimExclusivo }) => d >= inicio && d < fimExclusivo;

describe("conversão instante ↔ relógio de Manaus", () => {
  it("instante real → civil: 03:59:59,999Z ainda é o dia anterior em Manaus; 04:00Z é o novo dia", () => {
    expect(iso(paraCivil(new Date("2026-04-01T03:59:59.999Z")))).toBe("2026-03-31T23:59:59.999Z");
    expect(iso(paraCivil(new Date("2026-04-01T04:00:00.000Z")))).toBe("2026-04-01T00:00:00.000Z");
    expect(iso(civilParaInstante(civil(2026, 3, 31, 23, 30)))).toBe("2026-04-01T03:30:00.000Z");
  });

  it("lê os formatos aceitos pela API", () => {
    const esperado = "2026-03-31T23:30:00.000Z"; // 31/03 23:30 em Manaus
    expect(iso(lerDataCivil("2026-03-31T23:30:00"))).toBe(esperado); // civil (frontend)
    expect(iso(lerDataCivil("2026-03-31T23:30"))).toBe(esperado);
    expect(iso(lerDataCivil("2026-03-31T23:30:00-04:00"))).toBe(esperado); // instante com offset
    expect(iso(lerDataCivil("2026-04-01T03:30:00.000Z"))).toBe(esperado); // instante UTC
    expect(iso(lerDataCivil("2026-04-01T04:30:00+01:00"))).toBe(esperado); // 03:30Z
    expect(iso(lerDataCivil(new Date("2026-04-01T03:30:00Z")))).toBe(esperado); // Date = instante
    expect(iso(lerDataCivil(Date.UTC(2026, 3, 1, 3, 30)))).toBe(esperado); // ms = instante
    expect(iso(lerDataCivil("2026-03-31"))).toBe("2026-03-31T00:00:00.000Z"); // data civil
    expect(iso(lerDataCivil("2026-03-31T23:59:59.5"))).toBe("2026-03-31T23:59:59.500Z");
  });

  it("rejeita formatos fora do contrato (Invalid Date, como o new Date de lixo) e mantém o transbordo de dia do V8", () => {
    for (const lixo of ["lixo", "31/03/2026", "2026-13-01", "2026-03-31T25:00:00", "", null, undefined, {}]) {
      expect(Number.isNaN(lerDataCivil(lixo).getTime())).toBe(true);
    }
    expect(iso(lerDataCivil("2026-02-30"))).toBe("2026-03-02T00:00:00.000Z"); // como new Date("2026-02-30")
  });
});

describe("limites de dia em Manaus", () => {
  const dia = intervaloDoDia(civil(2026, 9, 29, 14, 37));
  it("00:00:00,000 e 23:59:59,999 pertencem ao dia; 00:00 do dia seguinte não", () => {
    expect(dentro(civil(2026, 9, 29, 0, 0, 0, 0), dia)).toBe(true);
    expect(dentro(civil(2026, 9, 29, 23, 59, 59), dia)).toBe(true);
    expect(dentro(civil(2026, 9, 29, 23, 59, 59, 999), dia)).toBe(true);
    expect(dentro(civil(2026, 9, 30, 0, 0, 0, 0), dia)).toBe(false);
    expect(dentro(civil(2026, 9, 28, 23, 59, 59, 999), dia)).toBe(false);
  });
});

describe("limites de mês e ano", () => {
  it.each([
    ["fevereiro (28 dias)", 2026, 2, "2026-02-28", "2026-03-01"],
    ["fevereiro bissexto (29 dias)", 2028, 2, "2028-02-29", "2028-03-01"],
    ["mês de 30 dias", 2026, 4, "2026-04-30", "2026-05-01"],
    ["mês de 31 dias", 2026, 3, "2026-03-31", "2026-04-01"],
    ["dezembro → janeiro do ano seguinte", 2026, 12, "2026-12-31", "2027-01-01"],
  ])("%s: 1º instante e último ms dentro, virada fora", (_, ano, mes, ultimoDia, seguinte) => {
    const p = intervaloDoMes(ano, mes);
    expect(iso(p.inicio)).toBe(`${ano}-${String(mes).padStart(2, "0")}-01T00:00:00.000Z`);
    expect(iso(p.fimExclusivo)).toBe(`${seguinte}T00:00:00.000Z`);
    expect(dentro(p.inicio, p)).toBe(true);
    expect(dentro(lerDataCivil(`${ultimoDia}T23:59:59.999`), p)).toBe(true);
    expect(dentro(lerDataCivil(`${ultimoDia}T23:59:59.5`), p)).toBe(true); // o antigo K16
    expect(dentro(lerDataCivil(seguinte), p)).toBe(false);
  });

  it("aceita ano/mês como string da query e transborda como antes (mes=13 → janeiro seguinte)", () => {
    expect(iso(intervaloDoMes("2026", "3").inicio)).toBe("2026-03-01T00:00:00.000Z");
    expect(iso(intervaloDoMes(2026, 13).inicio)).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("semana e intervalo de datas", () => {
  it("semana de domingo a sábado, inclusive atravessando o ano", () => {
    const qua = intervaloDaSemana(civil(2026, 9, 30, 15));
    expect([iso(qua.inicio), iso(qua.fimExclusivo)]).toEqual(["2026-09-27T00:00:00.000Z", "2026-10-04T00:00:00.000Z"]);
    const reveillon = intervaloDaSemana(civil(2026, 12, 31, 23, 59));
    expect([iso(reveillon.inicio), iso(reveillon.fimExclusivo)]).toEqual(["2026-12-27T00:00:00.000Z", "2027-01-03T00:00:00.000Z"]);
  });

  it("dataInicio/dataFim incluem os dois dias civis inteiros", () => {
    const p = intervaloEntreDatas("2026-03-31", "2026-04-01");
    expect([iso(p.inicio), iso(p.fimExclusivo)]).toEqual(["2026-03-31T00:00:00.000Z", "2026-04-02T00:00:00.000Z"]);
    expect(dentro(lerDataCivil("2026-04-01T23:59:59.999"), p)).toBe(true);
  });
});

describe("dias civis em texto (Etapa 2: janelas do Agente de Estoque)", () => {
  it("diaCivilISO, deslocarDiaISO (fevereiro bissexto, virada do ano) e hojeCivilISO em Manaus", () => {
    expect(diaCivilISO(civil(2026, 3, 31, 23, 59))).toBe("2026-03-31");
    expect(deslocarDiaISO("2028-03-01", -1)).toBe("2028-02-29");
    expect(deslocarDiaISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(deslocarDiaISO("2026-09-30", -29)).toBe("2026-09-01");
    expect(hojeCivilISO()).toBe(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Manaus" }).format(new Date()));
  });
});

describe("rótulos e serialização", () => {
  it("rótulos pelo calendário civil (inclui o ano atípico 206 do histórico)", () => {
    expect(formatarDiaCivil(civil(2026, 4, 1, 0, 30))).toBe("01/04/2026");
    expect(nomeDoMes(civil(2026, 3, 1))).toBe("março");
    expect(rotuloMesAno(civil(2026, 4, 1, 0, 30))).toBe("abril de 2026");
    expect(formatarDiaCivil(civil(206, 3, 5))).toBe("05/03/206");
  });

  it("serializa o civil com o deslocamento real de Manaus: instante ISO correto e legível como horário local", () => {
    const s = serializarCivil(civil(2026, 3, 31, 23, 30));
    expect(s).toBe("2026-03-31T23:30:00.000-04:00");
    expect(new Date(s).toISOString()).toBe("2026-04-01T03:30:00.000Z");
    expect(serializarCivil(new Date(NaN))).toBeNull();
  });

  it("replacer JSON: data e dataPagamento saem em Manaus; criadoEm (instante técnico) continua em UTC", () => {
    const json = JSON.parse(
      JSON.stringify(
        { data: civil(2026, 3, 31, 23, 30), dataPagamento: null, venda: { dataPagamento: civil(2026, 4, 1, 9) }, criadoEm: new Date("2026-04-01T03:30:00Z") },
        replacerJsonTemporal,
      ),
    );
    expect(json).toEqual({
      data: "2026-03-31T23:30:00.000-04:00",
      dataPagamento: null,
      venda: { dataPagamento: "2026-04-01T09:00:00.000-04:00" },
      criadoEm: "2026-04-01T03:30:00.000Z",
    });
  });
});

describe("independência do fuso do processo", () => {
  it("as mesmas funções dão o mesmo resultado em processos com TZ=UTC e TZ=America/Manaus", () => {
    const url = pathToFileURL(path.resolve("src/lib/periodos.js")).href;
    const codigo = `
      const p = await import(${JSON.stringify(url)});
      const i = (x) => [x.inicio.toISOString(), x.fimExclusivo.toISOString()];
      console.log(JSON.stringify([
        i(p.intervaloDoMes("2026", "3")), i(p.intervaloDoMes(2026, 12)),
        i(p.intervaloDoDia(p.civil(2026, 3, 31, 23, 59))), i(p.intervaloDaSemana(p.civil(2026, 12, 31))),
        i(p.intervaloEntreDatas("2026-03-31", "2026-04-01")),
        p.lerDataCivil("2026-03-31T23:30:00").toISOString(), p.lerDataCivil("2026-04-01T03:30:00Z").toISOString(),
        p.paraCivil(new Date("2026-04-01T03:59:59.999Z")).toISOString(),
        p.formatarDiaCivil(p.civil(2026, 4, 1, 0, 30)), p.nomeDoMes(p.civil(2026, 3, 1)), p.rotuloMesAno(p.civil(2026, 4, 1)),
        p.serializarCivil(p.civil(2026, 3, 31, 23, 30)),
      ]));`;
    const rodar = (TZ) => {
      const r = spawnSync(process.execPath, ["--input-type=module", "-e", codigo], { env: { ...process.env, TZ }, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    const utc = rodar("UTC");
    expect(rodar("America/Manaus")).toBe(utc);
    expect(rodar("Asia/Tokyo")).toBe(utc); // um terceiro fuso qualquer, bem distante
  });
});
