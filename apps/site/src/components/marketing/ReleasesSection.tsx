import { ExternalLink } from 'lucide-react';
import { siteConfig } from '@/lib/site.config';

interface Release {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  html_url: string;
}

interface ParsedRelease {
  version: string;
  title: string;
  date: string;
  url: string;
  summary: string;
  sections: { label: string; items: string[] }[];
  downloads: { label: string; url: string }[];
}

function parseReleaseBody(release: Release): ParsedRelease {
  const body = release.body || '';
  const lines = body.split('\n');

  // Extract summary (first blockquote or first paragraph)
  let summary = '';
  const summaryMatch = body.match(/>\s*(?:\[!(?:IMPORTANT|NOTE)\]\s*\n>\s*)?(.+)/);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
  }

  // Extract sections (### headers with bullet lists)
  const sections: { label: string; items: string[] }[] = [];
  let currentSection: { label: string; items: string[] } | null = null;

  for (const line of lines) {
    const headerMatch = line.match(/^###\s+(.+)/);
    if (headerMatch) {
      const label = headerMatch[1].replace(/[^\w\s\u4e00-\u9fff]/g, '').trim();
      if (label && !label.toLowerCase().includes('download') && !label.toLowerCase().includes('faq')) {
        currentSection = { label, items: [] };
        sections.push(currentSection);
      } else {
        currentSection = null;
      }
      continue;
    }
    if (currentSection && line.match(/^-\s+/)) {
      const item = line.replace(/^-\s+/, '').trim();
      if (item) currentSection.items.push(item);
    }
  }

  // Extract download links
  const downloads: { label: string; url: string }[] = [];
  const linkRegex = /\[([^\]]+)\]\((https:\/\/github\.com\/[^)]+\/download\/[^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(body)) !== null) {
    downloads.push({ label: match[1], url: match[2] });
  }

  const version = release.tag_name.replace(/^v/, '');

  return {
    version,
    title: release.name || `v${version}`,
    date: new Date(release.published_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    url: release.html_url,
    summary,
    sections: sections.filter(s => s.items.length > 0),
    downloads,
  };
}

async function getRecentReleases(): Promise<ParsedRelease[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${siteConfig.repo.owner}/${siteConfig.repo.name}/releases?per_page=5`,
      { next: { revalidate: 1800 } } // 30 min cache
    );
    if (!res.ok) return [];
    const releases = (await res.json()) as Release[];
    return releases.map(parseReleaseBody);
  } catch {
    return [];
  }
}

export async function ReleasesSection({
  content,
}: {
  content: { title: string; titleLight: string; viewAll: string };
}) {
  const releases = await getRecentReleases();

  if (releases.length === 0) return null;

  return (
    <section className="py-20 md:py-28">
      <div className="mx-auto max-w-[800px] px-6">
        {/* Two-tone title */}
        <h2 className="max-w-2xl text-2xl font-bold leading-snug md:text-3xl">
          <span className="text-foreground">{content.title}</span>{' '}
          <span className="text-muted-foreground">{content.titleLight}</span>
        </h2>

        {/* Release cards */}
        <div className="mt-10 space-y-4">
          {releases.map((release) => (
            <a
              key={release.version}
              href={release.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                      v{release.version}
                    </span>
                    <span className="text-xs text-muted-foreground">{release.date}</span>
                  </div>
                  {release.summary && (
                    <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
                      {release.summary}
                    </p>
                  )}
                  {/* Show first section's items as preview */}
                  {release.sections.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-foreground/80">
                        {release.sections[0].label}
                      </p>
                      <ul className="mt-1.5 space-y-0.5">
                        {release.sections[0].items.slice(0, 3).map((item, i) => (
                          <li key={i} className="text-xs text-muted-foreground">
                            <span className="mr-1.5 text-muted-foreground/50">&bull;</span>
                            {item}
                          </li>
                        ))}
                        {release.sections[0].items.length > 3 && (
                          <li className="text-xs text-muted-foreground/50">
                            +{release.sections[0].items.length - 3} more
                          </li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/30 transition-colors group-hover:text-foreground" />
              </div>
            </a>
          ))}
        </div>

        {/* View all link */}
        <div className="mt-6 text-center">
          <a
            href={siteConfig.repo.releases}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {content.viewAll}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
