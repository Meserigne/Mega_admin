import Link from "next/link";
import { TresorerieAnomalies } from "@/components/TresorerieAnomalies";
import { Alert, Card, PageHeader, StatCard } from "@/components/ui";
import { formatFcfa, formatFcfaLabel } from "@/lib/format";
import { getTresorerieMensuelle } from "@/lib/tresorerie";

export const dynamic = "force-dynamic";

function TableauMensuel({
  title,
  lignes,
  soldeActuel,
}: {
  title: string;
  lignes: {
    label: string;
    debut: number;
    entrees: number;
    sorties: number;
    fin: number;
  }[];
  soldeActuel?: number;
}) {
  const moisCourant = new Date().getUTCMonth(); // 0-based
  const ligneCourante = lignes[moisCourant];

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-4">
        <h2 className="section-title">{title}</h2>
        {soldeActuel !== undefined && (
          <p className="text-sm text-slate-600">
            Solde actuel :{" "}
            <strong
              className={`tabular-nums ${
                soldeActuel < 0 ? "text-red-600" : "text-mega-800"
              }`}
            >
              {formatFcfa(soldeActuel)}
            </strong>
            {ligneCourante && (
              <span className="ml-2 text-xs text-slate-400">
                (fin {ligneCourante.label} : {formatFcfa(ligneCourante.fin)})
              </span>
            )}
          </p>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">Mois</th>
              <th className="text-right">Solde début</th>
              <th className="text-right">Entrées</th>
              <th className="text-right">Sorties</th>
              <th className="text-right">Solde fin</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, idx) => (
              <tr
                key={l.label}
                className={`${l.fin < 0 ? "bg-red-50/80" : ""} ${
                  idx === moisCourant ? "bg-mega-50/60" : ""
                }`}
              >
                <td className="font-medium">
                  {l.label}
                  {idx === moisCourant && (
                    <span className="ml-2 text-[10px] font-semibold uppercase text-mega-700">
                      en cours
                    </span>
                  )}
                </td>
                <td className="text-right text-slate-600">
                  {formatFcfa(l.debut)}
                </td>
                <td className="text-right font-medium text-mega-700">
                  {formatFcfa(l.entrees)}
                </td>
                <td className="text-right font-medium text-red-600">
                  {formatFcfa(l.sorties)}
                </td>
                <td
                  className={`text-right font-semibold ${l.fin < 0 ? "text-red-600" : "text-slate-900"}`}
                >
                  {formatFcfa(l.fin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default async function TresoreriePage() {
  const data = await getTresorerieMensuelle();
  if (!data) {
    return <p>Base non initialisée.</p>;
  }

  const soldes = data.soldesActuels;
  const devise = data.params.devise;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trésorerie"
        description={`Exercice ${data.params.annee} · recalculée automatiquement à chaque écriture approuvée`}
      />

      {soldes && (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Solde banque"
            value={formatFcfaLabel(soldes.soldeBanque, devise)}
            variant={soldes.soldeBanque < 0 ? "negative" : "positive"}
          />
          <StatCard
            label="Solde petite caisse"
            value={formatFcfaLabel(soldes.soldeCaisse, devise)}
            variant={soldes.soldeCaisse < 0 ? "negative" : "positive"}
          />
          <StatCard
            label="Trésorerie totale"
            value={formatFcfaLabel(soldes.tresorerieTotale, devise)}
            variant={soldes.tresorerieTotale < 0 ? "negative" : "positive"}
          />
        </div>
      )}

      {soldes && soldes.pendingCount > 0 && (
        <Alert type="info">
          <strong>{soldes.pendingCount}</strong> opération(s) en attente
          d&apos;approbation CEO ({formatFcfa(soldes.pendingMontant)} FCFA) :{" "}
          non incluses dans la trésorerie tant qu&apos;elles ne sont pas
          approuvées.{" "}
          <Link href="/approbations" className="font-medium underline">
            Voir les approbations
          </Link>
        </Alert>
      )}

      <TresorerieAnomalies anomalies={data.anomalies} />

      <Alert type="info">
        <strong>Banque</strong> = journal hors Cash (chèques, virements, mobile
        money). <strong>Petite caisse</strong> = espèces. Une écriture Cash du
        journal (ou saisie en caisse) est synchronisée automatiquement et ne
        compte qu&apos;une fois dans la trésorerie.
      </Alert>

      <TableauMensuel
        title="Banque"
        lignes={data.banque}
        soldeActuel={soldes?.soldeBanque}
      />
      <TableauMensuel
        title="Petite caisse"
        lignes={data.caisse}
        soldeActuel={soldes?.soldeCaisse}
      />
      <TableauMensuel
        title="Trésorerie totale"
        lignes={data.total}
        soldeActuel={soldes?.tresorerieTotale}
      />
    </div>
  );
}
