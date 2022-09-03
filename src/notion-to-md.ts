import { Client, isFullBlock } from "@notionhq/client";
import { GetBlockResponse } from "@notionhq/client/build/src/api-endpoints";
import { MdBlock, NotionToMarkdownOptions, CustomTransformer } from "./types";
import * as md from "./utils/md";
import { getBlockChildren } from "./utils/notion";

/**
 * Converts a Notion page to Markdown.
 */
export class NotionToMarkdown {
  private notionClient: Client;
  private customTransformers: Record<string, CustomTransformer>;
  constructor(options: NotionToMarkdownOptions) {
    this.notionClient = options.notionClient;
    this.customTransformers = {};
  }
  setCustomTransformer(
    type: string,
    transformer: CustomTransformer
  ): NotionToMarkdown {
    this.customTransformers[type] = transformer;

    return this;
  }
  /**
   * Converts Markdown Blocks to string
   * @param {MdBlock[]} mdBlocks - Array of markdown blocks
   * @param {number} nestingLevel - Defines max depth of nesting
   * @returns {string} - Returns markdown string
   */
  toMarkdownString(mdBlocks: MdBlock[] = [], nestingLevel: number = 0): string {
    let mdString = "";
    mdBlocks.forEach((mdBlocks) => {
      // process parent blocks
      if (mdBlocks.parent) {
        if (
          mdBlocks.type !== "to_do" &&
          mdBlocks.type !== "bulleted_list_item" &&
          mdBlocks.type !== "numbered_list_item"
        ) {
          // add extra line breaks non list blocks
          mdString += `\n${md.addTabSpace(mdBlocks.parent, nestingLevel)}\n\n`;
        } else {
          mdString += `${md.addTabSpace(mdBlocks.parent, nestingLevel)}\n`;
        }
      }

      // process child blocks
      if (mdBlocks.children && mdBlocks.children.length > 0) {
        if (mdBlocks.type === "synced_block") {
          mdString += this.toMarkdownString(mdBlocks.children, nestingLevel);
        } else {
          mdString += this.toMarkdownString(
            mdBlocks.children,
            nestingLevel + 1
          );
        }
      }
    });
    return mdString;
  }

  /**
   * Retrieves Notion Blocks based on ID and converts them to Markdown Blocks
   * @param {string} id - notion page id (not database id)
   * @param {number} totalPage - Retrieve block children request number, page_size Maximum = totalPage * 100 (Default=null)
   * @returns {Promise<MdBlock[]>} - List of markdown blocks
   */
  async pageToMarkdown(
    id: string,
    totalPage: number | null = null
  ): Promise<MdBlock[]> {
    if (!this.notionClient) {
      throw new Error(
        "notion client is not provided, for more details check out https://github.com/souvikinator/notion-to-md"
      );
    }

    const blocks = await getBlockChildren(this.notionClient, id, totalPage);

    const parsedData = await this.blocksToMarkdown(blocks);
    return parsedData;
  }

  /**
   * Converts list of Notion Blocks to Markdown Blocks
   * @param {ListBlockChildrenResponseResults | undefined} blocks - List of notion blocks
   * @param {number} totalPage - Retrieve block children request number, page_size Maximum = totalPage * 100
   * @param {MdBlock[]} mdBlocks - Defines max depth of nesting
   * @returns {Promise<MdBlock[]>} - Array of markdown blocks with their children
   */
  async blocksToMarkdown(
    blocks?: GetBlockResponse[],
    totalPage: number | null = null,
    mdBlocks: MdBlock[] = []
  ): Promise<MdBlock[]> {
    if (!this.notionClient) {
      throw new Error(
        "notion client is not provided, for more details check out https://github.com/souvikinator/notion-to-md"
      );
    }

    if (!blocks) return mdBlocks;

    for (const block of blocks) {
      if (!isFullBlock(block)) continue;
      let expiry_time: string | undefined = undefined;
      if (block.type === "pdf" && block.pdf.type === "file") {
        expiry_time = block.pdf.file.expiry_time;
      }
      if (block.type === "image" && block.image.type === "file") {
        expiry_time = block.image.file.expiry_time;
      }
      if (block.type === "video" && block.video.type === "file") {
        expiry_time = block.video.file.expiry_time;
      }
      if (block.type === "file" && block.file.type === "file") {
        expiry_time = block.file.file.expiry_time;
      }

      if (
        block.has_children &&
        block.type !== "column_list" &&
        block.type !== "toggle" &&
        block.type !== "callout" &&
        block.type !== "quote"
      ) {
        let child_blocks = await getBlockChildren(
          this.notionClient,
          block.id,
          totalPage
        );

        mdBlocks.push({
          type: block.type,
          parent: await this.blockToMarkdown(block),
          children: [],
          expiry_time,
        });

        await this.blocksToMarkdown(
          child_blocks,
          totalPage,
          mdBlocks[mdBlocks.length - 1].children
        );
        continue;
      }
      let tmp = await this.blockToMarkdown(block);
      mdBlocks.push({
        type: block.type,
        parent: tmp,
        children: [],
        expiry_time,
      });
    }
    return mdBlocks;
  }

  /**
   * Converts a Notion Block to a Markdown Block
   * @param block - single notion block
   * @returns corresponding markdown string of the passed block
   */
  async blockToMarkdown(block: GetBlockResponse): Promise<string> {
    if (typeof block !== "object" || !("type" in block)) return "";

    const { type } = block;
    if (type in this.customTransformers && !!this.customTransformers[type])
      return await this.customTransformers[type](block);

    switch (type) {
      case "image":
        {
          let blockContent = block.image;
          const image_caption_plain = blockContent.caption
            .map((item) => item.plain_text)
            .join("");
          const image_type = blockContent.type;
          if (image_type === "external")
            return md.image(image_caption_plain, blockContent.external.url);
          if (image_type === "file")
            return md.image(image_caption_plain, blockContent.file.url);
        }
        break;

      case "divider": {
        return md.divider();
      }

      case "equation": {
        return md.codeBlock(block.equation.expression);
      }

      case "video":
      case "file":
      case "pdf":
        {
          let blockContent;
          if (type === "video") blockContent = block.video;
          if (type === "file") blockContent = block.file;
          if (type === "pdf") blockContent = block.pdf;
          if (blockContent) {
            const file_type = blockContent.type;
            if (file_type === "external")
              return md.link("image", blockContent.external.url);
            if (file_type === "file")
              return md.link("image", blockContent.file.url);
          }
        }
        break;

      case "bookmark":
      case "embed":
      case "link_preview":
      case "link_to_page":
      case "child_page":
      case "child_database":
        {
          let blockContent;
          let title: string = type;
          if (type === "bookmark") blockContent = block.bookmark;
          if (type === "embed") blockContent = block.embed;
          if (type === "link_preview") blockContent = block.link_preview;
          if (
            type === "link_to_page" &&
            block.link_to_page.type === "page_id"
          ) {
            blockContent = { url: block.link_to_page.page_id };
          }

          if (type === "child_page") {
            blockContent = { url: block.id };
            title = block.child_page.title;
          }

          if (type === "child_database") {
            blockContent = { url: block.id };
            title = block.child_database.title || "child_database";
          }

          if (blockContent) return md.link(title, blockContent.url);
        }
        break;

      case "table": {
        const { id, has_children } = block;
        let tableArr: string[][] = [];
        if (has_children) {
          const tableRows = await getBlockChildren(this.notionClient, id, 100);
          // console.log(">>", tableRows);
          let rowsPromise = tableRows?.map(async (row) => {
            const { type } = row as any;
            const cells = (row as any)[type]["cells"];

            /**
             * this is more like a hack since matching the type text was
             * difficult. So converting each cell to paragraph type to
             * reuse the blockToMarkdown function
             */
            let cellStringPromise = cells.map(
              async (cell: any) =>
                await this.blockToMarkdown({
                  type: "paragraph",
                  paragraph: { rich_text: cell },
                } as GetBlockResponse)
            );

            const cellStringArr = await Promise.all(cellStringPromise);
            // console.log("~~", cellStringArr);
            tableArr.push(cellStringArr);
            // console.log(tableArr);
          });
          await Promise.all(rowsPromise || []);
        }
        return md.table(tableArr);
      }

      case "column_list": {
        const { id, has_children } = block;

        if (!has_children) return "";

        const column_list_children = await getBlockChildren(
          this.notionClient,
          id,
          100
        );

        let column_list_promise = column_list_children.map(
          async (column) => await this.blockToMarkdown(column)
        );

        let column_list: string[] = await Promise.all(column_list_promise);

        return column_list.join("\n\n");
      }

      case "column": {
        const { id, has_children } = block;
        if (!has_children) return "";

        const column_children = await getBlockChildren(
          this.notionClient,
          id,
          100
        );

        const column_children_promise = column_children.map(
          async (column_child) => await this.blockToMarkdown(column_child)
        );

        let column: string[] = await Promise.all(column_children_promise);
        return column.join("\n\n");
      }

      case "toggle": {
        const { id, has_children } = block;

        const toggle_summary = block.toggle.rich_text[0]?.plain_text;

        // empty toggle
        if (!has_children) {
          return md.toggle(toggle_summary);
        }

        const toggle_children_object = await getBlockChildren(
          this.notionClient,
          id,
          100
        );

        // parse children blocks to md object
        const toggle_children = await this.blocksToMarkdown(
          toggle_children_object
        );

        // convert children md object to md string
        const toggle_children_md_string =
          this.toMarkdownString(toggle_children);

        return md.toggle(toggle_summary, toggle_children_md_string);
      }

      case "paragraph":
        return md.richText(block.paragraph.rich_text);
      case "heading_1":
        return md.heading1(md.richText(block.heading_1.rich_text));
      case "heading_2":
        return md.heading2(md.richText(block.heading_2.rich_text));
      case "heading_3":
        return md.heading3(md.richText(block.heading_3.rich_text));
      case "bulleted_list_item":
        return md.bullet(md.richText(block.bulleted_list_item.rich_text));
      case "numbered_list_item":
        return md.bullet(md.richText(block.numbered_list_item.rich_text), 1);
      case "to_do":
        return md.todo(md.richText(block.to_do.rich_text), block.to_do.checked);
      case "code":
        return md.codeBlock(
          md.richText(block.code.rich_text, true),
          block.code.language
        );
      case "callout":
        const { id, has_children } = block;
        const callout_text = md.richText(block.callout.rich_text);
        if (!has_children) return md.callout(callout_text, block.callout.icon);

        let callout_string = "";

        const callout_children_object = await getBlockChildren(
          this.notionClient,
          id,
          100
        );

        // parse children blocks to md object
        const callout_children = await this.blocksToMarkdown(
          callout_children_object
        );

        callout_string += `${callout_text}\n`;
        callout_children.map((child) => {
          callout_string += `${child.parent}\n\n`;
        });

        return md.callout(callout_string.trim(), block.callout.icon);
      case "quote":
        const quote_text = md.richText(block.quote.rich_text)
        if (!block.has_children) return md.quote(quote_text);
        let quote_string = "";
        const quote_children_object = await getBlockChildren(
          this.notionClient,
          block.id,
          100
        );
        const quote_children = await this.blocksToMarkdown(
          quote_children_object
        );

        quote_string += `${quote_text}\n`;
        quote_children.map((child) => {
          quote_string += `${child.parent}\n\n`;
        });

        return md.quote(quote_string.trim());

      case "template":
      case "synced_block":
      case "child_page":
      case "child_database":
      case "column":
      case "link_preview":
      case "column_list":
      case "link_to_page":
      case "breadcrumb":
      case "unsupported":
      case "table_of_contents":
      case "audio":
        return "";
    }
    return "";
  }
}
