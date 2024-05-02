import markdownTable from "markdown-table";
import {
  AudioBlockObjectResponse,
  EquationRichTextItemResponse,
  MentionRichTextItemResponse,
  PdfBlockObjectResponse,
  RichTextItemResponse,
  TextRichTextItemResponse,
  VideoBlockObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";
import katex from "katex";
import { CalloutIcon } from "../types";
import { getPageLinkFromId } from "./notion";
import { Client } from "@notionhq/client";
require("katex/contrib/mhchem");
export const inlineCode = (text: string) => {
  return `\`${text}\``;
};

export const bold = (text: string) => {
  return `**${text}**`;
};

export const italic = (text: string) => {
  return `_${text}_`;
};

export const strikethrough = (text: string) => {
  return `~~${text}~~`;
};

export const underline = (text: string) => {
  return `<u>${text}</u>`;
};

export const link = (text: string, href: string) => {
  return `[${text}](${href})`;
};

export const codeBlock = (text: string, language?: string) => {
  if (language === "plain text") language = "text";

  return `\`\`\`${language}
${text}
\`\`\``;
};

export const heading1 = (text: string) => {
  return `# ${text}`;
};

export const heading2 = (text: string) => {
  return `## ${text}`;
};

export const heading3 = (text: string) => {
  return `### ${text}`;
};

export const quote = (text: string) => {
  // the replace is done to handle multiple lines
  return `> ${text.replace(/\n/g, "  \n> ")}`;
};

export const callout = (text: string, icon?: CalloutIcon) => {
  let emoji: string | undefined;
  if (icon?.type === "emoji") {
    emoji = icon.emoji;
  }

  // the replace is done to handle multiple lines
  return `> ${emoji ? emoji + " " : ""}${text.replace(/\n/g, "  \n> ")}`;
};

export const bullet = (text: string, count?: number) => {
  let renderText = text.trim();
  return count ? `${count}. ${renderText}` : `- ${renderText}`;
};

export const todo = (text: string, checked: boolean) => {
  return checked ? `- [x] ${text}` : `- [ ] ${text}`;
};

export const image = (alt: string, href: string) => {
  return `![${alt}](${href})`;
};

export const addTabSpace = (text: string, n = 0) => {
  const tab = "	";
  for (let i = 0; i < n; i++) {
    if (text.includes("\n")) {
      const multiLineText = text.split(/(?<=\n)/).join(tab);
      text = tab + multiLineText;
    } else text = tab + text;
  }
  return text;
};

export const divider = () => {
  return "---";
};

export const toggle = (summary?: string, children?: string) => {
  if (!summary) return children || "";
  return `<details>
  <summary>${summary}</summary>

${children || ""}

  </details>`;
};

export const table = (cells: string[][]) => {
  return markdownTable(cells);
};

export const plainText = (textArray: RichTextItemResponse[]) => {
  return textArray.map((text) => text.plain_text).join("");
};

function textRichText(text: TextRichTextItemResponse): string {
  const annotations = text.annotations;
  let content = text.text.content;
  if (annotations.bold) {
    content = bold(content);
  }
  if (annotations.code) {
    content = inlineCode(content);
  }
  if (annotations.italic) {
    content = italic(content);
  }
  if (annotations.strikethrough) {
    content = strikethrough(content);
  }
  if (annotations.underline) {
    content = underline(content);
  }
  if (text.href) {
    content = link(content, text.href);
  }
  return content;
}

function equationRichText(text: EquationRichTextItemResponse): string {
  return katex.renderToString(text.equation.expression, {
    displayMode: false,
    throwOnError: false,
  });
}

async function mentionRichText(
  text: MentionRichTextItemResponse,
  notion: Client
): Promise<string> {
  const mention = text.mention;
  switch (mention.type) {
    case "page":
      const pageId = mention.page.id;
      const linkInfo = await getPageLinkFromId(pageId, notion);
      if (linkInfo) {
        return link(linkInfo.title, linkInfo.link);
      }
      console.warn(`Failed to get page link for page with id ${pageId}`);
      return "";
    case "database":
    case "date":
    case "user":
    case "link_preview":
    case "template_mention": {
      console.warn("Unsupported mention type: ", mention.type);
      return "";
    }
  }
}

export async function richText(
  textArray: RichTextItemResponse[],
  notion: Client
) {
  return (
    await Promise.all(
      textArray.map(async (text) => {
        if (text.type === "text") {
          return textRichText(text);
        } else if (text.type === "equation") {
          return equationRichText(text);
        } else if (text.type === "mention") {
          return await mentionRichText(text, notion);
        }
      })
    )
  ).join("");
}

export const video = (block: VideoBlockObjectResponse) => {
  const videoBlock = block.video;
  if (videoBlock.type === "file") {
    return htmlVideo(videoBlock.file.url);
  }
  const url = videoBlock.external.url;
  if (url.startsWith("https://www.youtube.com/")) {
    /*
      YouTube video links that include embed or watch.
      E.g. https://www.youtube.com/watch?v=[id], https://www.youtube.com/embed/[id]
    */
    // get last 11 characters of the url as the video id
    const videoId = url.slice(-11);
    return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }
  return htmlVideo(url);
};

function htmlVideo(url: string) {
  return `<video controls style="height:auto;width:100%;">
  <source src="${url}">
  <p>
    Your browser does not support HTML5 video. Here is a
    <a href="${url}" download="${url}">link to the video</a> instead.
  </p>
</video>`;
}

export const pdf = (block: PdfBlockObjectResponse) => {
  const pdfBlock = block.pdf;
  const url =
    pdfBlock.type === "file" ? pdfBlock.file.url : pdfBlock.external.url;
  return `<embed src="${url}" type="application/pdf" style="width: 100%;aspect-ratio: 2/3;height: auto;" />`;
};

export const audio = (block: AudioBlockObjectResponse) => {
  const audioBlock = block.audio;
  const url =
    audioBlock.type === "file" ? audioBlock.file.url : audioBlock.external.url;
  return `<audio controls src="${url}"></audio>`;
};
