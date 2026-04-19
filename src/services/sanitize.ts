const DANGEROUS_TAGS =
  "script, foreignObject, iframe, object, embed, link, meta, form, input, textarea, button, base";

const URL_ATTRS = new Set(["href", "xlink:href", "src", "action", "formaction"]);
const DANGEROUS_SCHEMES = /^\s*(javascript|vbscript|data|file):/i;

class RemoveElement {
  element(el: Element) {
    el.remove();
  }
}

class SanitizeAttributes {
  element(el: Element) {
    for (const [name, value] of [...el.attributes]) {
      if (name === undefined) continue;
      if (/^on/i.test(name)) {
        el.removeAttribute(name);
        continue;
      }
      if (
        URL_ATTRS.has(name.toLowerCase()) &&
        value !== undefined &&
        DANGEROUS_SCHEMES.test(value)
      ) {
        el.removeAttribute(name);
      }
    }
  }
}

export async function sanitizeSvg(svg: string): Promise<string> {
  const res = new Response(svg, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  const out = new HTMLRewriter()
    .on(DANGEROUS_TAGS, new RemoveElement())
    .on("*", new SanitizeAttributes())
    .transform(res);
  return out.text();
}
