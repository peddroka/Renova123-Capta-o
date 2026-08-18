import type { PageKey } from "@renova123/shared";
import { HeroHeader } from "@renova123/ui";
import { pageMeta } from "../navigation";

export function PageHeader({ pageKey, actions }: { pageKey: PageKey; actions?: React.ReactNode | undefined }) {
  const meta = pageMeta[pageKey];
  const Icon = meta.icon;
  return <HeroHeader eyebrow={meta.eyebrow} title={meta.title} description={meta.description} icon={<Icon />} actions={actions} />;
}
