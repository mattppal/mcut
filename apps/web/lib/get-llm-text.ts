import { source } from "@/lib/source";

export async function getLLMText(page: (typeof source)["$inferPage"]) {
  const processed = await page.data.getText("processed");

  return [
    `# ${page.data.title}`,
    "",
    `URL: ${page.url}`,
    `Source: ${page.path}`,
    "",
    processed,
  ].join("\n");
}
