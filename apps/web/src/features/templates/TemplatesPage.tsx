import type { CampaignDTO, TemplateDTO } from "@crm/shared";
import { SectionTitle } from "../../components";

import { useCrm } from "../../context/CrmContext";

export function TemplatesPage() {
  const { analytics: { templates, campaigns } } = useCrm();
  return (
    <div className="page-grid">
      <section className="panel span-2">
        <SectionTitle title="Approved Templates" />
        {templates.map((t) => (
          <article className="template-card" key={t.id}>
            <strong>{t.name}</strong>
            <small>{t.category} - {t.language}</small>
            <p>{t.body}</p>
          </article>
        ))}
      </section>
      <section className="panel">
        <SectionTitle title="Campaigns" />
        {campaigns.map((c) => (
          <p className="timeline-item" key={c.id}>
            {c.name}<small>{c.status}</small>
          </p>
        ))}
      </section>
    </div>
  );
}
