/** Shared public collection shell. Uses the same surface, border and violet
 * accent vocabulary as ScribeCat's internal calendar and task views. */
export const publicCss = `
:root{color-scheme:light dark;--sc-bg:#f7f6fa;--sc-surface:#fff;--sc-raised:#faf9fc;--sc-text:#211d29;--sc-muted:#716b7d;--sc-border:#e6e1eb;--sc-accent:#a855f7;--sc-accent-soft:#f3e8ff}
*{box-sizing:border-box}body{margin:0;background:var(--sc-bg);color:var(--sc-text);font:1rem/1.55 system-ui,-apple-system,sans-serif}a{color:inherit;text-decoration:none}
.public-top{position:relative;max-width:none;padding:.85rem clamp(1rem,2vw,2rem);border-bottom:1px solid var(--sc-border);background:var(--sc-surface);font-weight:750;letter-spacing:-.03em}.public-top span{color:var(--sc-accent)}
.public-layout{display:grid;grid-template-columns:minmax(12rem,15rem) minmax(0,1fr);min-height:calc(100vh - 3.4rem)}
.public-sidebar{display:flex;flex-direction:column;gap:.28rem;padding:1.3rem .8rem;border-right:1px solid var(--sc-border);background:var(--sc-surface)}
.public-sidebar strong{padding:.65rem .7rem;color:var(--sc-muted);font-size:.72rem;letter-spacing:.13em;text-transform:uppercase}
.public-sidebar a{display:block;padding:.65rem .8rem;border-radius:.55rem;font-size:.9rem}.public-sidebar a:hover,.public-sidebar a:focus-visible{background:var(--sc-accent-soft);color:#6b21a8;outline:none}
.public-content{min-width:0;max-width:80rem;width:100%;padding:clamp(1rem,3vw,2.6rem);margin:0 auto}.public-content h1{font-size:clamp(1.8rem,3vw,2.6rem);letter-spacing:-.04em;line-height:1.15;margin:.25rem 0 1.2rem}
.public-content h2{letter-spacing:-.025em}.public-content .back{display:inline-flex;margin-bottom:1.3rem;color:var(--sc-accent)}
.public-content .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,13rem),1fr));gap:.8rem;list-style:none;padding:0}
.public-content .card,.public-content .cards a,.public-content .detail,.public-content .recipe,.public-content section{background:var(--sc-surface);border:1px solid var(--sc-border);border-radius:.8rem;overflow:hidden;box-shadow:none}
.public-content .card,.public-content .cards a{transition:border-color .16s,transform .16s}.public-content .card:hover,.public-content .cards a:hover{border-color:var(--sc-accent);transform:translateY(-2px)}
.public-content .card img,.public-content .cards img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}.public-content .card div,.public-content .detail div{padding:1rem}
.public-content .card:not(:has(img)):before,.public-content .cards a:not(:has(img)):before{content:"";display:block;min-height:5.5rem;background:radial-gradient(circle at 22% 30%,var(--sc-accent-soft) 0 16%,transparent 17%),linear-gradient(135deg,var(--sc-raised),var(--sc-accent-soft))}
.public-content .meta,.public-content .muted,.public-content .intro{color:var(--sc-muted)}
.public-content input,.public-content select,.public-content button{font:inherit;color:var(--sc-text);background:var(--sc-surface);border:1px solid var(--sc-border);border-radius:.5rem;padding:.55rem .7rem;max-width:100%}
.public-content button{cursor:pointer}.public-content button:hover{border-color:var(--sc-accent)}.public-content input[type=checkbox]{width:1.15rem;height:1.15rem;padding:0;accent-color:var(--sc-accent)}
.public-content .filters{display:flex;gap:.65rem;flex-wrap:wrap;margin:1rem 0 1.4rem}.public-content .filters input{flex:1;min-width:12rem}
.public-content .filters button,.public-content form.add button{background:var(--sc-accent);border-color:var(--sc-accent);color:#fff}
.public-content .recipe-hero{display:grid;grid-template-columns:1fr 1fr}.public-content .recipe-body{display:grid;grid-template-columns:minmax(12rem,1fr) minmax(0,1.5fr);gap:1.4rem}.public-content .recipe-body section{padding:1rem}
.public-content .detail{max-width:60rem}.public-content .detail img{max-height:28rem;object-fit:cover}.public-content .summary,.public-content .description{white-space:pre-line}
.public-content form.add{display:flex;gap:.5rem;flex-wrap:wrap;margin:1rem 0}.public-content form.add input{flex:1;min-width:9rem}.public-content .toggle label{display:flex;gap:.65rem;align-items:center;padding:.45rem}.public-content .done{color:var(--sc-muted);text-decoration:line-through}
.public-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr));gap:.7rem;margin:1.3rem 0 2rem}.public-stats div{display:grid;gap:.2rem;padding:1rem;border:1px solid var(--sc-border);border-left:3px solid var(--sc-accent);border-radius:.65rem;background:var(--sc-surface)}.public-stats span{font-size:.8rem;color:var(--sc-muted)}.public-stats strong{font-size:1.6rem;line-height:1.2}
@media(max-width:48rem){.public-layout{display:block}.public-sidebar{border-right:0;border-bottom:1px solid var(--sc-border);padding:.5rem 1rem;flex-direction:row;overflow-x:auto;white-space:nowrap}.public-sidebar strong{display:none}.public-content .recipe-hero,.public-content .recipe-body{grid-template-columns:1fr}}
@media(prefers-color-scheme:dark){:root{--sc-bg:#151318;--sc-surface:#1e1b24;--sc-raised:#29252f;--sc-text:#f5f1f9;--sc-muted:#b6acbf;--sc-border:#37313f;--sc-accent-soft:#362340}.public-sidebar a:hover,.public-sidebar a:focus-visible{color:#d8b4fe}}
`;

export function publicFrame(title: string, content: string, home: string, links: Array<[string, string]>): string {
  const nav = `<a href="${home}">⌂ Oversikt</a>${links.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}`;
  return `<header class="public-top">Scribe<span>Cat</span> <span aria-hidden="true">/</span> ${title}</header><div class="public-layout"><aside class="public-sidebar"><strong>Utforsk</strong>${nav}</aside><main class="public-content">${content}</main></div>`;
}
