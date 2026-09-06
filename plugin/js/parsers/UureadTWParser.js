/*
 * Parser for https://www.uuread.tw/
 */

class UureadParser extends Parser {
    constructor() {
        super();
    }

    static get parserId() {
        return "uuread";
    }

    get parserId() {
        return UureadParser.parserId;
    }

    static get domains() {
        return ["uuread.tw", "www.uuread.tw"];
    }

    get domains() {
        return UureadParser.domains;
    }

    isHandledUrl(url) {
        try {
            let host = new URL(url).hostname.toLowerCase();
            return host === "uuread.tw" || host.endsWith(".uuread.tw");
        } catch (e) {
            return false;
        }
    }

    // =========================================================================
    // Helpers: Network & DOM Extraction
    // =========================================================================

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    toDocument(raw) {
        if (!raw) return null;
        if (typeof raw.querySelectorAll === "function") {
            return raw;
        }
        if (raw.responseXML && typeof raw.responseXML.querySelectorAll === "function") {
            return raw.responseXML;
        }
        if (typeof raw === "string") {
            return (new DOMParser()).parseFromString(raw, "text/html");
        }
        if (raw.responseText) {
            return (new DOMParser()).parseFromString(raw.responseText, "text/html");
        }
        return null;
    }

    async fetchDoc(url, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                let response = await HttpClient.wrapFetch(url);
                let doc = this.toDocument(response);
                if (doc) return doc;
            } catch (err) {
                if (attempt === retries) throw err;
                await this.delay(1000 * attempt);
            }
        }
        return null;
    }

    async fetchDocSafe(url) {
        try {
            return await this.fetchDoc(url, 2);
        } catch (e) {
            return null;
        }
    }

    extractBookId(url, dom) {
        if (url) {
            let match = url.match(/\/(?:book|chapter)\/([a-zA-Z0-9]+)(?:\/|\.html|_|-|$)/i);
            if (match && match[1]) {
                return match[1];
            }
        }
        if (dom) {
            let scriptText = (dom.documentElement || dom.body) ? (dom.documentElement || dom.body).innerHTML : "";
            let idMatch = scriptText.match(/var\s+(?:articleid|bookid|article_id)\s*=\s*["']([^"']+)["']/i);
            if (idMatch && idMatch[1]) {
                return idMatch[1];
            }
        }
        return null;
    }

    cleanChapterTitle(title) {
        if (!title || typeof title !== "string") return "";
        return title
        .replace(/[（(]\s*\d+\s*[/／]\s*\d+\s*[)）]/g, "") // Strips （1 / 2）, (1/2), （1／2）
        .replace(/[（(]\s*第?\s*\d+\s*[頁页]\s*[)）]/g, "") // Strips （第1頁）
        .replace(/[（(]\s*[一二三四五六七八九十]+\s*[)）]/g, "") // Strips （一）, （二）
        .replace(/[（(]\s*\d+\s*[)）]/g, "") // Strips (1), (2)
        .replace(/\s+/g, " ")
        .trim();
    }

    // =========================================================================
    // Metadata Extraction
    // =========================================================================

    extractTitleImpl(dom) {
        dom = this.toDocument(dom);
        if (!dom) return "Unknown Title";

        // Specified selector: head > meta:nth-child(17)
        let userMeta = dom.querySelector("head > meta:nth-child(17)");
        if (userMeta && userMeta.getAttribute("content")) {
            let content = userMeta.getAttribute("content").trim();
            if (content) return content;
        }

        let meta = dom.querySelector('meta[property="og:novel:book_name"], meta[property="og:title"]');
        if (meta && meta.content) {
            return meta.content.trim();
        }
        let h1 = dom.querySelector(".book-info h1, .info h1, .title h1, h1");
        if (h1) {
            return h1.textContent.trim();
        }
        let titleEl = dom.querySelector("title");
        if (titleEl) {
            return titleEl.textContent.split(/最新章[节節]|_|-/)[0].trim();
        }
        return "Unknown Title";
    }

    extractAuthor(dom) {
        dom = this.toDocument(dom);
        if (!dom) return "Unknown Author";

        // Specified selector: head > meta:nth-child(21)
        let userMeta = dom.querySelector("head > meta:nth-child(21)");
        if (userMeta && userMeta.getAttribute("content")) {
            let content = userMeta.getAttribute("content").trim();
            if (content) return content;
        }

        let meta = dom.querySelector('meta[property="og:novel:author"]');
        if (meta && meta.content) {
            return meta.content.trim();
        }
        let authorLink = dom.querySelector("a[href*='/author/']");
        if (authorLink) {
            return authorLink.textContent.trim();
        }
        let bodyText = dom.body ? dom.body.textContent : "";
        let match = bodyText.match(/作者[：:]\s*([^\s\n\r<]+)/);
        return match ? match[1].trim() : "Unknown Author";
    }

    extractCoverUrl(dom) {
        dom = this.toDocument(dom);
        if (!dom) return null;

        let base = dom.baseURI || "https://www.uuread.tw/";

        // Specified selector: head > meta:nth-child(19)
        let userMeta = dom.querySelector("head > meta:nth-child(19)");
        if (userMeta) {
            let val = userMeta.getAttribute("content") || userMeta.getAttribute("value") ||
            userMeta.getAttribute("href") || userMeta.getAttribute("src");
            if (val && /\.(?:jpg|jpeg|png|webp|gif)(?:$|[?#])/i.test(val.trim())) {
                return new URL(val.trim(), base).href;
            }
        }

        let meta = dom.querySelector('meta[property="og:image"]');
        if (meta && meta.content) {
            return new URL(meta.content, base).href;
        }
        let img = dom.querySelector(".bookimg img, .book-img img, .cover img, .pic img, .imgbox img, .info img");
        if (img) {
            let src = img.getAttribute("data-original") || img.getAttribute("data-src") || img.getAttribute("src");
            if (src && !src.startsWith("data:")) {
                return new URL(src.trim(), base).href;
            }
        }
        return null;
    }

    extractDescription(dom) {
        dom = this.toDocument(dom);
        if (!dom) return "";

        // Specified selector: head > meta:nth-child(18)
        let userMeta = dom.querySelector("head > meta:nth-child(18)");
        if (userMeta && userMeta.getAttribute("content")) {
            let content = userMeta.getAttribute("content").trim();
            if (content) return content;
        }

        let meta = dom.querySelector('meta[property="og:description"]');
        if (meta && meta.content) {
            return meta.content.trim();
        }
        let desc = dom.querySelector("#intro, .intro, .description, .synopsis, .bookintro");
        return desc ? desc.textContent.trim() : "";
    }

    extractSubject(dom) {
        dom = this.toDocument(dom);
        if (!dom) return "";

        let subjects = [];
        let catMeta = dom.querySelector('meta[property="og:novel:category"]');
        if (catMeta && catMeta.content) {
            subjects.push(catMeta.content.trim());
        }
        let tagEls = dom.querySelectorAll(".tag, .tags a, .tag-list a");
        tagEls.forEach(el => {
            let t = el.textContent.trim();
            if (t && !subjects.includes(t)) subjects.push(t);
        });
            return subjects.join(", ");
    }

    extractLanguage(dom) {
        return "zh-TW";
    }

    // =========================================================================
    // Objective 2: Extract Non-duplicate, Serial Chapter URLs (Toc: #newlist)
    // =========================================================================

    async getChapterUrls(dom, chapterUrlsUI) {
        dom = this.toDocument(dom);
        let currentUrl = (dom && dom.baseURI) ? dom.baseURI : (this.state ? this.state.chapterListUrl : "");
        let baseOrigin = "https://www.uuread.tw";
        if (currentUrl) {
            try {
                baseOrigin = new URL(currentUrl).origin;
            } catch (e) {
                baseOrigin = "https://www.uuread.tw";
            }
        }

        let catalogUrls = new Set();
        if (currentUrl) {
            catalogUrls.add(currentUrl);
        }

        let chapterCatalogLink = dom.querySelector("a[href*='/chapter/'], a[href*='/read/'], a[href*='index.html']");
        if (chapterCatalogLink && chapterCatalogLink.getAttribute("href")) {
            catalogUrls.add(new URL(chapterCatalogLink.getAttribute("href"), currentUrl || baseOrigin).href);
        }

        let discoverCatalogUrls = (docObj) => {
            if (!docObj || typeof docObj.querySelectorAll !== "function") return;

            let selects = docObj.querySelectorAll("select");
            for (let sel of selects) {
                for (let i = 0; i < sel.options.length; i++) {
                    let opt = sel.options[i];
                    let val = opt.value ? opt.value.trim() : "";
                    if (val && (val.includes(".html") || val.includes("/"))) {
                        catalogUrls.add(new URL(val, baseOrigin).href);
                    }
                }
            }

            let pageLinks = docObj.querySelectorAll(".page a, .pages a, #pagelist a, .pagination a");
            for (let a of pageLinks) {
                let href = a.getAttribute("href");
                if (href && !href.startsWith("javascript:") && !href.startsWith("#")) {
                    catalogUrls.add(new URL(href, baseOrigin).href);
                }
            }
        };

        discoverCatalogUrls(dom);

        let chaptersMap = new Map();
        let processedUrls = new Set();

        for (let catUrl of catalogUrls) {
            if (processedUrls.has(catUrl)) continue;
            processedUrls.add(catUrl);

            let catDom = (catUrl === currentUrl) ? dom : await this.fetchDocSafe(catUrl);
            catDom = this.toDocument(catDom);
            if (!catDom || typeof catDom.querySelectorAll !== "function") continue;

            discoverCatalogUrls(catDom);

            // Specified selector: Toc: #newlist
            let tocContainer = catDom.querySelector("#newlist") ||
            catDom.querySelector("#chapterlist, #list, .chapterlist, .directory-list, #chapters");

            let links = tocContainer ? tocContainer.querySelectorAll("a[href]") : catDom.querySelectorAll("a[href]");

            for (let a of links) {
                let href = a.getAttribute("href");
                if (!href || href.startsWith("javascript:") || href.startsWith("#")) continue;

                let fullUrl = new URL(href, baseOrigin).href;

                // Filter out subpages (_2.html, _3.html, etc.) from the TOC
                if (/_(?:[2-9]|\d{2,})\.html(?:$|[?#])/i.test(fullUrl)) {
                    continue;
                }

                if (!tocContainer && !/\.html(?:$|[?#])/i.test(fullUrl)) {
                    continue;
                }

                let title = this.cleanChapterTitle(a.textContent);
                if (!title) continue;

                if (/^(上一[頁页]|下一[頁页]|[首尾][頁页]|[目章][錄录]|返回)$/i.test(title)) {
                    continue;
                }

                if (!chaptersMap.has(fullUrl)) {
                    chaptersMap.set(fullUrl, {
                        sourceUrl: fullUrl,
                        title: title
                    });
                }
            }

            await this.delay(100);
        }

        if (chaptersMap.size === 0) {
            throw new Error("No serial chapters found on: " + currentUrl);
        }

        let finalChapterList = Array.from(chaptersMap.values());

        if (chapterUrlsUI && typeof chapterUrlsUI.showTocProgress === "function") {
            chapterUrlsUI.showTocProgress(finalChapterList);
        }

        return finalChapterList;
    }

    // =========================================================================
    // Objective 3: Multi-paged Chapter Extraction & Content Merging (chapter id)_(2/+)
    // =========================================================================

    findContent(dom) {
        dom = this.toDocument(dom);
        if (!dom) return null;

        let selectors = [
            "#htmlContent", "#htmlcontent",
            "#booktxt", "#booktext", ".booktxt", ".booktext",
            "#readcontent", "#readContent", ".readcontent", ".readContent",
            "#nr1", "#nr", "#nr_con", "#nr_content",
            "#contentbox", ".contentbox",
            "#chaptercontent", "#chapterContent", ".chaptercontent", ".chapterContent",
            "#chapter-content", ".chapter-content",
            "#chapter_content", ".chapter_content",
            "#BookText", ".BookText",
            "#content", ".content",
            "#novelcontent", "#novel_content", ".novelcontent",
            "#chaptertext", ".chaptertext", "#chapterText",
            "#txt", "#text", "#txtContent", "#TextContent",
            "#showtxt", ".showtxt",
            ".txtnav", "#txtnav",
            "#articlecontent", "#article_content",
            "#maintext", ".maintext",
            "#zhengwen", ".zhengwen",
            "article", ".entry-content"
        ];

        for (let sel of selectors) {
            let el = dom.querySelector(sel);
            if (el && el.textContent.trim().length > 30) {
                return el;
            }
        }

        return dom.querySelector("#content, .content, article, body");
    }

    findChapterTitle(dom) {
        dom = this.toDocument(dom);
        if (!dom) return "";
        let h1 = dom.querySelector("h1, #title, .title h1, .read-title, .reader-title, .chapter-title, #read_title");
        let raw = h1 ? h1.textContent.trim().replace(/\s+/g, " ") : "";
        return this.cleanChapterTitle(raw);
    }

    cleanContent(content) {
        if (!content) return;

        let removeSelectors = [
            "script", "style", "ins", "iframe",
            ".ad", ".ads", "[class*='advert']",
            "#thumb", ".bottem", ".bottem2", ".read-nav", ".page-nav", ".chapter-nav",
            ".read_nav", ".prenext", "#page", ".page", ".button", ".btn"
        ];
        removeSelectors.forEach(sel => {
            content.querySelectorAll(sel).forEach(el => el.remove());
        });

        let unwantedPhrases = [
            "（本章未完，請點擊下一頁繼續閱讀）",
            "（本章未完，请点击下一页继续阅读）",
            "本章未完，請點擊下一頁繼續閱讀",
            "本章未完，请点击下一页继续阅读",
            "點擊下一頁繼續閱讀",
            "点击下一页继续阅读",
            "（繼續下一頁）",
            "『點此報錯』",
            "『点此报错』",
            "加入書籤",
            "加入书签",
            "uu看書",
            "UU看書",
            "uu看书",
            "UU看书",
            "uuread.tw",
            "www.uuread.tw",
            "tj();",
            "錯亂章節催更",
            "错乱章节催更"
        ];

        let paras = content.querySelectorAll("p, div, span");
        for (let p of paras) {
            let txt = p.textContent.trim();
            for (let phrase of unwantedPhrases) {
                if (txt === phrase) {
                    p.remove();
                    break;
                } else if (txt.includes(phrase)) {
                    p.textContent = p.textContent.replace(phrase, "").trim();
                }
            }
        }

        for (let node of Array.from(content.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE) {
                let text = node.textContent;
                for (let phrase of unwantedPhrases) {
                    if (text.includes(phrase)) {
                        node.textContent = text.replace(phrase, "").trim();
                    }
                }
            }
        }
    }

    findNextSubPageUrl(dom, currentUrl, bookId, chapterId, nextPageNum) {
        dom = this.toDocument(dom);
        if (!dom) return null;

        // Matches (chapter id)_(2/+).html (e.g. 1511861_2.html or /chapter/1885410/1511861_2.html)
        let targetRegex = new RegExp(
            `(?:^|/)${chapterId}_${nextPageNum}\\.html(?:$|[?#])`,
                                     "i"
        );

        let links = dom.querySelectorAll("a[href]");
        for (let a of links) {
            let href = a.getAttribute("href");
            if (href && targetRegex.test(href)) {
                return new URL(href, currentUrl).href;
            }
        }

        // Check Traditional ("下一頁") and Simplified ("下一页") links
        for (let a of links) {
            let text = a.textContent.trim();
            if ((text.includes("下一頁") || text.includes("下一页") || text.includes("下頁") || text.includes("下页")) &&
                !text.includes("下一章") && !text.includes("下一節")) {
                let href = a.getAttribute("href");
            if (!href) continue;

            let subMatch = href.match(/_(\d+)\.html/i);
                if (subMatch && parseInt(subMatch[1], 10) === nextPageNum) {
                    return new URL(href, currentUrl).href;
                }
                }
        }

        // Direct fallback: if text states the chapter is unfinished, construct candidate URL
        let bodyText = dom.body ? dom.body.textContent : "";
        let h1Text = dom.querySelector("h1, #title") ? dom.querySelector("h1, #title").textContent : "";
        if (h1Text.includes(`${nextPageNum - 1} / `) || h1Text.includes(`${nextPageNum - 1}/`) ||
            bodyText.includes("本章未完") || bodyText.includes("點擊下一頁") || bodyText.includes("点击下一页")) {
            let u = new URL(currentUrl);
            let dir = u.pathname.substring(0, u.pathname.lastIndexOf("/") + 1);
            return `${u.origin}${dir}${chapterId}_${nextPageNum}.html`;
            }

            return null;
    }

    async fetchChapter(url) {
        let dom = await this.fetchDoc(url);
        if (!dom) return null;

        let content = this.findContent(dom);
        if (!content) return dom;

        this.cleanContent(content);

        // Extracts bookId and chapterId from uuread.tw URL format:
        // /chapter/1885410/1511861.html or /book/1885410/1511861.html
        let bookId = "";
        let chapterId = "";
        let match = url.match(/(?:\/chapter\/|\/book\/|\/)(\d+)\/(\d+)(?:_\d+)?\.html/i);
        if (match) {
            bookId = match[1];
            chapterId = match[2];
        } else {
            let match2 = url.match(/\/(\d+)(?:_\d+)?\.html/i);
            if (match2) {
                chapterId = match2[1];
            }
        }

        if (!chapterId) {
            return dom;
        }

        let currentDom = dom;
        let currentUrl = url;
        let nextPageNum = 2;
        const MAX_SUBPAGES = 30;

        while (nextPageNum <= MAX_SUBPAGES) {
            let nextSubPageUrl = this.findNextSubPageUrl(
                currentDom,
                currentUrl,
                bookId,
                chapterId,
                nextPageNum
            );

            if (!nextSubPageUrl || nextSubPageUrl === currentUrl) {
                break;
            }

            await this.delay(150);

            let subDom = await this.fetchDocSafe(nextSubPageUrl);
            subDom = this.toDocument(subDom);
            if (!subDom) {
                break;
            }

            // Stop if server returned an error or 404 page
            let subDocTitle = subDom.title || "";
            if (/404|不存在|找不到/i.test(subDocTitle)) {
                break;
            }

            let subContent = this.findContent(subDom);
            if (subContent && subContent.textContent.trim().length > 20) {
                this.cleanContent(subContent);

                // Append all child nodes from portion 2+ into the main content element
                while (subContent.firstChild) {
                    let node = dom.adoptNode ? dom.adoptNode(subContent.firstChild) : subContent.firstChild;
                    content.appendChild(node);
                }

                currentDom = subDom;
                currentUrl = nextSubPageUrl;
                nextPageNum++;
            } else {
                break;
            }
        }

        // Clean merged content to remove the watermark left on portion 1
        this.cleanContent(content);

        return dom;
    }
}

// Register parser with WebToEpub
parserFactory.register("uuread.tw", () => new UureadParser());
