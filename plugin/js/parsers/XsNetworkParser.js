// Ai generated Gemini 4 Hydrogen
"use strict";

parserFactory.register("shuhaoxs.com", () => new XsNetworkParser());
parserFactory.register("nnshushe.com", () => new XsNetworkParser());
parserFactory.register("zhongxiaxs.com", () => new XsNetworkParser());
parserFactory.register("yangmiaoxs.com", () => new XsNetworkParser());
parserFactory.register("heiyaxs.com", () => new XsNetworkParser());
parserFactory.register("nianxiaxs.com", () => new XsNetworkParser());
parserFactory.register("klxs123.com", () => new XsNetworkParser());

class XsNetworkParser extends Parser {
    constructor() {
        super();
        this.minimumThrottle = 3000;
    }

    async getChapterUrls(dom, chapterUrlsUI) {
        let bookUrl = util.isUrl(dom.baseURI) ? dom.baseURI : "https://www.shuhaoxs.com/";
        this.tocURL = bookUrl;

        let firstChapters = this.extractChaptersFromDom(dom);
        let pageNumbers = this.extractTocPageNumbers(dom);
        if (pageNumbers.length <= 1) {
            return firstChapters;
        }

        let currentPage = this.getCurrentTocPage(dom);
        let articleId = this.extractArticleId(dom);
        let cipherConfig = await this.getCipherConfig(dom, bookUrl);

        let chapters = [];
        try {
            for (let page of pageNumbers) {
                let pageChapters;
                if (page === currentPage) {
                    pageChapters = firstChapters;
                } else {
                    await this.waitBetweenRequests();
                    pageChapters = await this.fetchTocPage(bookUrl, articleId, page, cipherConfig);
                }
                if (pageChapters.length > 0) {
                    chapterUrlsUI?.showTocProgress(pageChapters);
                    chapters.push(...pageChapters);
                }
            }
        } finally {
            await this.setNavigationHeaders(bookUrl);
        }
        return chapters;
    }

    async waitBetweenRequests() {
        if (this.userPreferences != null) {
            await this.rateLimitDelay();
        } else {
            await util.sleep(this.minimumThrottle);
        }
    }

    extractArticleId(dom) {
        let dropDownAid = dom.querySelector(".pageS .dropDown[data-aid], .page2[data-aid]")?.getAttribute("data-aid");
        if (dropDownAid) {
            return dropDownAid.trim();
        }
        for (let script of dom.querySelectorAll("script:not([src])")) {
            let match = (script.textContent || "").match(/\barticleid\s*=\s*["']([^"']+)["']/);
            if (match) {
                return match[1].trim();
            }
        }
        try {
            let pathMatch = new URL(dom.baseURI).pathname.match(/\/book\/([^/-]+)(?:-\d+)?\.html/i);
            if (pathMatch) {
                return pathMatch[1];
            }
        } catch {
            // Ignore malformed baseURI
        }
        throw new Error("Unable to locate article ID.");
    }

    getCurrentTocPage(dom) {
        let curLi = dom.querySelector(".pageS .dropDown li.cur[data-p]");
        let raw = curLi?.getAttribute("data-p")
        || dom.querySelector(".page2 .chapter_page select option[selected]")?.getAttribute("value")
        || dom.querySelector(".page2 .chapter_page select option")?.getAttribute("value");
        let parsed = parseInt(raw, 10);
        return isNaN(parsed) ? 1 : parsed;
    }

    extractTocPageNumbers(dom) {
        let items = [...dom.querySelectorAll(".pageS .dropDown li[data-p]")];
        let pages = items.length > 0
            ? items.map(li => parseInt(li.getAttribute("data-p"), 10))
            : [...dom.querySelectorAll(".page2 .chapter_page select option")].map(opt => parseInt(opt.value || opt.getAttribute("value"), 10));
        return [...new Set(pages.filter(n => !isNaN(n) && (n > 0)))].sort((a, b) => a - b);
    }

    extractChaptersFromDom(dom) {
        let menu = dom.querySelector(".chapListBody ul, .direList.chapter_list ul");
        let chapters = util.hyperlinksToChapterList(menu);
        for (let chapter of chapters) {
            chapter.title = this.cleanTitle(chapter.title);
        }
        return chapters;
    }

    findCipherScriptUrls(dom, baseUrl) {
        let knownStatic = new Set([
            "layer.js", "crypto-js.min.js", "public.js", "common.js", "content.js", "swiper.min.js"
        ]);
        let urls = [];
        for (let script of dom.querySelectorAll("script[src*='/templates/js/'], script[src*='/template/js/']")) {
            let src = script.getAttribute("src") || "";
            let file = src.split("/").pop().split("?")[0].toLowerCase();
            if (file.endsWith(".js") && !knownStatic.has(file) && !file.startsWith("jquery")) {
                urls.push(util.resolveRelativeUrl(baseUrl, src));
            }
        }
        return urls;
    }

    makeWrapOptions(fetchOptions) {
        let wrapOptions = {
            parser: this
        };
        if (fetchOptions != null) {
            wrapOptions.fetchOptions = fetchOptions;
        }
        wrapOptions.errorHandler = new XsNetworkErrorHandler(this, wrapOptions);
        return wrapOptions;
    }

    async getCipherConfig(dom, bookUrl) {
        let fallback = {
            secretKey: XsNetworkParser.DEFAULT_AES_KEY,
            iv: XsNetworkParser.DEFAULT_AES_IV
        };
        for (let scriptUrl of this.findCipherScriptUrls(dom, bookUrl)) {
            try {
                await this.waitBetweenRequests();
                await this.setRequestHeaders(bookUrl, [
                    { header: "referer", operation: "set", value: bookUrl },
                    { header: "sec-fetch-dest", operation: "set", value: "script" },
                    { header: "sec-fetch-mode", operation: "set", value: "no-cors" },
                    { header: "sec-fetch-site", operation: "set", value: "same-origin" },
                    { header: "origin", operation: "remove" }
                ]);
                let response = await HttpClient.wrapFetch(scriptUrl, { errorHandler: new XsNetworkErrorHandler(this) });
                if (!this.isHtmlContentType(response) && (response.arrayBuffer != null)) {
                    let scriptText = this.decodeResponseBytes(response.arrayBuffer);
                    let keyMatch = scriptText.match(/new\s+AESCrypt\s*\(\s*["']([^"']+)["']\s*\)/);
                    let ivMatch = scriptText.match(/this\.iv\s*=\s*CryptoJS\.enc\.Utf8\.parse\s*\(\s*["']([^"']+)["']\s*\)/);
                    if (keyMatch && ivMatch) {
                        return { secretKey: keyMatch[1], iv: ivMatch[1] };
                    }
                }
            } catch {
                // Try next script or fall back to defaults
            }
        }
        return fallback;
    }

    async encryptPostData(postData, secretKey, iv) {
        let encoder = new TextEncoder();
        let keyBytes = encoder.encode(secretKey);
        let ivBytes = encoder.encode(iv);
        let plainBytes = encoder.encode(JSON.stringify(postData));
        let cryptoKey = await crypto.subtle.importKey(
            "raw",
            keyBytes,
            { name: "AES-CBC" },
            false,
            ["encrypt"]
        );
        let encrypted = await crypto.subtle.encrypt(
            { name: "AES-CBC", iv: ivBytes },
            cryptoKey,
            plainBytes
        );
        let bytes = new Uint8Array(encrypted);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    async fetchTocPage(bookUrl, articleId, page, cipherConfig) {
        let encrypted = await this.encryptPostData(
            { id: articleId, page: page },
            cipherConfig.secretKey,
            cipherConfig.iv
        );
        let apiUrl = new URL("/index.php?action=loadChapterPage", bookUrl).href;
        let body = new URLSearchParams({ data: encrypted }).toString();

        await this.setAjaxHeaders(bookUrl);
        let response = await HttpClient.wrapFetch(apiUrl, this.makeWrapOptions({
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest"
            },
            body: body
        }));

        let json = this.tryParseTocJson(response);
        if (json == null) {
            throw new Error("Unexpected empty response from TOC API.");
        }
        return this.extractChaptersFromJson(json, bookUrl);
    }

    decodeResponseBytes(arrayBuffer) {
        return new TextDecoder("utf-8").decode(arrayBuffer);
    }

    extractChaptersFromJson(json, baseUrl) {
        if ((json == null) || (json.code == null) || (Number(json.code) !== 0) || !Array.isArray(json.data)) {
            throw new Error(json?.msg || "Failed to load chapter list page.");
        }
        return json.data
            .filter(item => item && item.chapterurl)
            .map(item => ({
                sourceUrl: new URL(item.chapterurl, baseUrl).href,
                title: this.cleanTitle(item.chaptername || ""),
                newArc: null
            }));
    }

    makeUrlFilter(url) {
        let parsed = new URL(url);
        if (!parsed.protocol.startsWith("http")) {
            return null;
        }
        let host = parsed.hostname.replace(/^www\./i, "");
        return "||" + host + "/";
    }

    async setRequestHeaders(refererUrl, requestHeaders) {
        let urlFilter = this.makeUrlFilter(refererUrl);
        if (urlFilter == null) {
            return;
        }
        await HttpClient.setDeclarativeNetRequestRules([{
            id: 1,
            priority: 1,
            action: {
                type: "modifyHeaders",
                requestHeaders: requestHeaders
            },
            condition: {
                urlFilter: urlFilter,
                resourceTypes: ["xmlhttprequest"]
            }
        }]);
    }

    async setNavigationHeaders(refererUrl) {
        await this.setRequestHeaders(refererUrl, [
            { header: "referer", operation: "set", value: refererUrl },
            { header: "sec-fetch-dest", operation: "set", value: "document" },
            { header: "sec-fetch-mode", operation: "set", value: "navigate" },
            { header: "sec-fetch-site", operation: "set", value: "same-origin" },
            { header: "origin", operation: "remove" }
        ]);
    }

    async setAjaxHeaders(refererUrl) {
        await this.setRequestHeaders(refererUrl, [
            { header: "referer", operation: "set", value: refererUrl },
            { header: "origin", operation: "set", value: new URL(refererUrl).origin },
            { header: "sec-fetch-dest", operation: "set", value: "empty" },
            { header: "sec-fetch-mode", operation: "set", value: "cors" },
            { header: "sec-fetch-site", operation: "set", value: "same-origin" }
        ]);
    }

    async fetchChapter(url) {
        let refererUrl = this.tocURL || new URL("/", url).href;
        await this.setNavigationHeaders(refererUrl);
        let dom = (await HttpClient.wrapFetch(url, this.makeWrapOptions())).responseXML;
        let mainContent = this.findContent(dom);
        if (mainContent == null) {
            return dom;
        }
        this.preparePageContent(mainContent);

        let visited = new Set([util.normalizeUrlForCompare(url)]);
        let currentReferer = url;
        let nextPageUrl = this.findNextChapterPageUrl(dom, url);
        while ((nextPageUrl != null) && !visited.has(util.normalizeUrlForCompare(nextPageUrl))) {
            visited.add(util.normalizeUrlForCompare(nextPageUrl));
            await this.waitBetweenRequests();
            await this.setNavigationHeaders(currentReferer);
            let nextDom = (await HttpClient.wrapFetch(nextPageUrl, this.makeWrapOptions())).responseXML;
            let nextContent = this.findContent(nextDom);
            if (nextContent == null) {
                break;
            }
            this.preparePageContent(nextContent);
            this.removeOverlappingLeadingElements(mainContent, nextContent);
            util.moveChildElements(nextContent, mainContent);
            currentReferer = nextPageUrl;
            nextPageUrl = this.findNextChapterPageUrl(nextDom, nextPageUrl);
        }
        return dom;
    }

    parseChapterPageUrl(url) {
        try {
            let match = new URL(url).pathname.match(/^\/book\/([^/-]+)-(\d+)(?:-(\d+))?\.html$/i);
            if (match == null) {
                return null;
            }
            return {
                bookId: match[1],
                chapterId: match[2],
                page: match[3] ? parseInt(match[3], 10) : 1
            };
        } catch {
            return null;
        }
    }

    findNextChapterPageUrl(dom, currentUrl) {
        let links = [...dom.querySelectorAll(".conBox .btnW a[href]")];
        let currentParsed = this.parseChapterPageUrl(currentUrl);
        let knownChapters = new Set(
            [...this.getPagesToFetch().keys()].map(u => util.normalizeUrlForCompare(u))
        );
        let normalizedToc = this.tocURL ? util.normalizeUrlForCompare(this.tocURL) : null;

        for (let link of links) {
            let rawHref = link.getAttribute("href")?.trim();
            if (!rawHref || rawHref.startsWith("#") || rawHref.toLowerCase().startsWith("javascript:")) {
                continue;
            }
            let resolvedUrl;
            try {
                resolvedUrl = util.resolveRelativeUrl(currentUrl, rawHref);
            } catch {
                continue;
            }
            if (!util.isUrl(resolvedUrl)) {
                continue;
            }
            let nextParsed = this.parseChapterPageUrl(resolvedUrl);
            if (currentParsed && nextParsed) {
                if ((currentParsed.bookId === nextParsed.bookId)
                    && (currentParsed.chapterId === nextParsed.chapterId)
                    && (nextParsed.page > currentParsed.page)) {
                    return resolvedUrl;
                }
                continue;
            }
            let normalizedResolved = util.normalizeUrlForCompare(resolvedUrl);
            if (knownChapters.has(normalizedResolved) || (normalizedResolved === normalizedToc)) {
                continue;
            }
            if (/^下一页(?:\s*[»›>]+)?$/.test(link.textContent.trim())) {
                return resolvedUrl;
            }
        }
        return null;
    }

    preparePageContent(element) {
        util.removeChildElementsMatchingSelector(element, "script, .rrAd, #adPcSlot, .btnErrorW, .btnW");
        this.cleanContentElement(element);
    }

    cleanContentElement(content) {
        if (content == null) {
            return;
        }
        let doc = content.ownerDocument;
        this.cleanInlineTextNodes(content);
        [...content.querySelectorAll("a")].filter(a => util.isElementWhiteSpace(a)).forEach(a => a.remove());

        let skipPreformatted = content.querySelector("pre, code") != null;
        if (!skipPreformatted && [...content.children].some(el => el.tagName.toLowerCase() === "br")) {
            content.replaceChildren(...this.splitBrContainerIntoParagraphs(doc, [...content.childNodes]));
        }

        for (let node of [...content.childNodes]) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (util.isStringWhiteSpace(node.nodeValue)) {
                    node.remove();
                } else {
                    let wrapped = util.wrapRawTextNode(node);
                    if (!skipPreformatted) {
                        this.trimParagraphEdges(wrapped);
                    }
                    node.replaceWith(wrapped);
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                let tag = node.tagName.toLowerCase();
                if ((tag === "p") && !skipPreformatted && this.isBrSeparatedParagraph(node)) {
                    node.replaceWith(...this.splitBrContainerIntoParagraphs(doc, [...node.childNodes]));
                } else if (tag === "p") {
                    if (!skipPreformatted && (node.querySelector("pre, code") == null)) {
                        this.trimParagraphEdges(node);
                    }
                    if (util.isElementWhiteSpace(node)) {
                        node.remove();
                    }
                } else if (((tag === "div") || (tag === "span")) && util.isElementWhiteSpace(node)) {
                    node.remove();
                }
            }
        }

        if (!skipPreformatted && [...content.children].some(el => el.tagName === "P")) {
            this.formatBlockSpacing(content);
        }
    }

    formatBlockSpacing(content) {
        let doc = content.ownerDocument;
        for (let node of [...content.childNodes]) {
            if ((node.nodeType === Node.TEXT_NODE) && util.isStringWhiteSpace(node.nodeValue)) {
                node.remove();
            }
        }
        let elements = [...content.children];
        for (let i = 0; i < elements.length - 1; i++) {
            let current = elements[i];
            let next = elements[i + 1];
            if (current.nextSibling === next) {
                content.insertBefore(doc.createTextNode("\n\n"), next);
            }
        }
    }

    isBrSeparatedParagraph(p) {
        return (p.querySelector("p, div, table, ul, ol, pre, code") == null)
        && (p.querySelectorAll("br").length >= 2);
    }

    splitBrContainerIntoParagraphs(doc, nodes) {
        const blockTags = new Set([
            "address", "article", "aside", "blockquote", "div", "dl", "fieldset",
            "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4",
            "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
            "section", "table", "ul"
        ]);
        let result = [];
        let bucket = [];

        let flushBucket = () => {
            if (bucket.length === 0) {
                return;
            }
            let p = doc.createElement("p");
            bucket.forEach(n => p.appendChild(n));
            bucket = [];
            this.trimParagraphEdges(p);
            if (!util.isElementWhiteSpace(p)) {
                result.push(p);
            }
        };

        for (let node of nodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
                let tag = node.tagName.toLowerCase();
                if (tag === "br") {
                    flushBucket();
                    continue;
                }
                if (blockTags.has(tag)) {
                    flushBucket();
                    if ((tag === "p") && this.isBrSeparatedParagraph(node)) {
                        result.push(...this.splitBrContainerIntoParagraphs(doc, [...node.childNodes]));
                    } else if (!util.isElementWhiteSpace(node)) {
                        if (tag === "p") {
                            this.trimParagraphEdges(node);
                        }
                        result.push(node);
                    }
                    continue;
                }
            }
            bucket.push(node);
        }
        flushBucket();
        return result;
    }

    trimParagraphEdges(p) {
        let walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let textNodes = [];
        for (let cur = walker.nextNode(); cur != null; cur = walker.nextNode()) {
            textNodes.push(cur);
        }
        for (let i = 0; i < textNodes.length; i++) {
            textNodes[i].nodeValue = textNodes[i].nodeValue.replace(/^[ \t\r\n\u3000]+/, "");
            if (textNodes[i].nodeValue !== "") {
                break;
            }
            textNodes[i].remove();
        }
        for (let i = textNodes.length - 1; i >= 0; i--) {
            if (!textNodes[i].isConnected) {
                continue;
            }
            textNodes[i].nodeValue = textNodes[i].nodeValue.replace(/[ \t\r\n\u3000]+$/, "");
            if (textNodes[i].nodeValue !== "") {
                break;
            }
            textNodes[i].remove();
        }
    }

    removeOverlappingLeadingElements(mainContent, nextContent) {
        let mainChildren = [...mainContent.children];
        let nextChildren = [...nextContent.children];
        let maxCheck = Math.min(5, mainChildren.length, nextChildren.length);
        for (let k = maxCheck; k >= 1; k--) {
            let matches = true;
            for (let i = 0; i < k; i++) {
                let mainEl = mainChildren[mainChildren.length - k + i];
                let nextEl = nextChildren[i];
                if ((mainEl.tagName !== "P") || (nextEl.tagName !== "P")) {
                    matches = false;
                    break;
                }
                let mainText = mainEl.textContent.trim();
                let nextText = nextEl.textContent.trim();
                if (!mainText || (mainText !== nextText) || ((k === 1) && (mainText.length < 8))) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                for (let i = 0; i < k; i++) {
                    nextChildren[i].remove();
                }
                return;
            }
        }
    }

    cleanInlineTextNodes(element) {
        let walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let textNodes = [];
        for (let cur = walker.nextNode(); cur != null; cur = walker.nextNode()) {
            textNodes.push(cur);
        }
        for (let textNode of textNodes) {
            let cleaned = this.stripJunkPromoLines(textNode.nodeValue);
            if ((cleaned !== textNode.nodeValue) && util.isStringWhiteSpace(cleaned)) {
                textNode.remove();
            } else {
                textNode.nodeValue = cleaned;
            }
        }
    }

    stripJunkPromoLines(text) {
        if (!text) {
            return "";
        }
        return text
            .replace(/作者[^\r\n。！？]{1,30}携《[^\r\n》]{1,60}》在[^\r\n。！？]{1,30}等你[。！!]?/g, "")
            .replace(/强力安利《[^\r\n》]{1,60}》[！!]?(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\S*直达精彩[。！!]?/gi, "")
            .replace(/偏爱[^\r\n？?]{1,20}[？?]点击(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}\S*进入专属书库[。！!]?/gi, "")
            .split(/\r?\n/)
            .filter(line => !this.isJunkPromoLine(line))
            .join("\n");
    }

    isJunkPromoLine(line) {
        let trimmed = (line || "").trim();
        if (!trimmed) {
            return false;
        }
        if (/^(?:[\s【[（(]*(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|net|org|cn|cc|tw|la|me|io|info|xyz|top|vip|club|co|icu|site|ink|wang|pw|tv|bz|in|pro|online|fun|ren|cx|sx|mobi|app|live|one|moe|asia|biz|shop|store|work|cloud|tech|win|ltd)(?:\/[^\s]*)?[\s】\]）)。，,!！?？,;；]*)+$/i.test(trimmed)) {
            return true;
        }
        if (/(?:shuhaoxs|nnshushe|zhongxiaxs|yangmiaoxs|heiyaxs|nianxiaxs|klxs123)\.com/i.test(trimmed)) {
            return true;
        }
        if (/(?:域名|网址|首发|书库|安利|直达精彩|书豪小说网|黑崖小说网|本章未完|下一页继续阅读).*(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|net|org|cn|cc|tw|la|xyz|top|vip|club|co|icu|site|ink))/i.test(trimmed)) {
            return true;
        }
        return false;
    }

    isHtmlContentType(response) {
        return (response?.contentType || "").toLowerCase().startsWith("text/html");
    }

    isTocApiUrl(url) {
        return (url || "").includes("action=loadChapterPage");
    }

    tryParseTocJson(response) {
        if (response == null) {
            return null;
        }
        let text;
        if (!this.isHtmlContentType(response) && (response.arrayBuffer != null)) {
            text = this.decodeResponseBytes(response.arrayBuffer).trim();
        } else if (this.isHtmlContentType(response) && (response.responseXML != null)) {
            text = response.responseXML.body?.textContent?.trim() || "";
        } else {
            return null;
        }
        if (!text.startsWith("{")) {
            return null;
        }
        try {
            let parsed = JSON.parse(text);
            if ((parsed != null)
                && (typeof parsed === "object")
                && Object.prototype.hasOwnProperty.call(parsed, "code")) {
                return parsed;
            }
        } catch {
            return null;
        }
        return null;
    }

    isJsResponse(response) {
        if (!this.isHtmlContentType(response) && (response?.arrayBuffer != null)) {
            return (response.contentType || "").toLowerCase().includes("javascript");
        }
        return false;
    }

    isChallengePage(dom) {
        if (dom == null) {
            return false;
        }
        if ((this.findContent(dom) != null)
            || (dom.querySelector(".chapListBody, .direList.chapter_list, .bookDetail") != null)) {
            return false;
        }
        if (dom.querySelector("#challenge-form, #cf-challenge-running, .cf-browser-verification, script[src*='/cdn-cgi/challenge-platform/'], #anubis_version, .cf-turnstile, .g-recaptcha, .h-captcha, .geetest_holder") != null) {
            return true;
        }
        if (dom.querySelector("img[src*='captcha'], input[name*='captcha'], input[placeholder*='验证码']") != null) {
            return true;
        }
        let text = dom.documentElement?.textContent || "";
        return /_cf_chl_opt|Just a moment\.\.\.|人机验证|安全验证|请完成验证|滑动验证|输入验证码/i.test(text);
    }

    isNoContentToError403AndContentNull(response) {
        if (!this.userPreferences?.noContentToError403?.value
            || !this.isHtmlContentType(response)
            || (response?.responseXML == null)
            || (this.tryParseTocJson(response) != null)
            || this.isJsResponse(response)
            || this.isTocApiUrl(response.response?.url)) {
            return false;
        }
        return (this.findContent(response.responseXML) == null)
            && (response.responseXML.querySelector(".chapListBody, .direList.chapter_list") == null);
    }

    isCustomError(response) {
        if (response == null) {
            return false;
        }
        let responseUrl = response.response?.url || "";
        if (this.isTocApiUrl(responseUrl)) {
            let parsed = this.tryParseTocJson(response);
            return (parsed == null)
            || (parsed.code == null)
            || (Number(parsed.code) !== 0)
            || !Array.isArray(parsed.data);
        }
        if (this.isHtmlContentType(response) && (response.responseXML != null)) {
            return this.isChallengePage(response.responseXML);
        }
        return false;
    }

    setCustomErrorResponse(url, wrapOptions, checkedresponse) {
        let responseUrl = checkedresponse?.response?.url || url;
        let isApiEndpoint = this.isTocApiUrl(url) || this.isTocApiUrl(responseUrl);
        let parsed = this.tryParseTocJson(checkedresponse);
        if (isApiEndpoint && ((parsed != null) || !this.isHtmlContentType(checkedresponse))) {
            return {
                url: url,
                wrapOptions: wrapOptions,
                response: {
                    url: responseUrl,
                    status: 999,
                    retryDelay: [10, 5]
                },
                errorMessage: parsed?.msg || "Failed to load chapter list page."
            };
        }
        if ((isApiEndpoint || responseUrl.endsWith(".js")) && this.tocURL) {
            responseUrl = this.tocURL;
        }
        return {
            url: url,
            wrapOptions: wrapOptions,
            response: {
                url: responseUrl,
                status: 403
            }
        };
    }

    findContent(dom) {
        return dom.querySelector(".conBox .content");
    }

    extractTitleImpl(dom) {
        let raw = dom.querySelector(".bookDetail .txtb .name a, .bookDetail .txtb .name h1")?.textContent?.trim()
        || dom.querySelector("meta[property='og:novel:book_name']")?.getAttribute("content")?.trim()
        || dom.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim();
        return raw ? this.cleanTitle(raw) : null;
    }

    extractAuthor(dom) {
        let author = dom.querySelector(".bookDetail .info dd a")?.textContent?.trim()
        || dom.querySelector(".bookDetail .infoM dd")?.textContent?.trim()
        || dom.querySelector("meta[property='og:novel:author']")?.getAttribute("content")?.trim();
        return author || super.extractAuthor(dom);
    }

    extractLanguage() {
        return "zh";
    }

    extractSubject(dom) {
        let category = dom.querySelector("meta[property='og:novel:category']")?.getAttribute("content")?.trim()
        || dom.querySelector(".bookDetail .tit .name")?.textContent?.trim();
        let tags = [...dom.querySelectorAll(".bookDetail .introM .labels span")]
            .map(e => e.textContent.trim())
            .filter(Boolean);
        if (tags.length === 0) {
            let keyEl = dom.querySelector(".bookDetail .key");
            if (keyEl != null) {
                let clone = keyEl.cloneNode(true);
                util.removeChildElementsMatchingSelector(clone, "a");
                let keyText = clone.textContent
                    .replace(/推荐[:：][\s\S]*$/, "")
                    .replace(/^关键字[:：]\s*/, "")
                    .trim();
                tags = keyText.split(/[、,，\s]+/).filter(Boolean);
            }
        }
        let combined = category ? [category, ...tags] : tags;
        return [...new Set(combined)].join(", ");
    }

    extractDescription(dom) {
        let desc = dom.querySelector(".bookDetail .txtb .intro")?.textContent
        || dom.querySelector("meta[property='og:description']")?.getAttribute("content")
        || "";
        return desc.trim().replace(/^简介[:：]\s*/, "").trim();
    }

    findChapterTitle(dom) {
        let titleEl = dom.querySelector(".conBox .titBox h1.title")
        || dom.querySelector("h1.title");
        if (titleEl != null) {
            let cleaned = this.cleanTitle(titleEl.textContent);
            return cleaned || null;
        }
        return null;
    }

    addTitleToContent(webPage, content) {
        super.addTitleToContent(webPage, content);
        if ((content == null) || (content.querySelector("pre, code") != null)) {
            return;
        }
        let first = content.firstElementChild;
        if ((first != null) && (first.tagName === "H1") && (first.nextSibling != null)) {
            if (first.nextSibling.nodeType !== Node.TEXT_NODE) {
                content.insertBefore(content.ownerDocument.createTextNode("\n\n"), first.nextSibling);
            }
        }
    }

    findCoverImageUrl(dom) {
        let img = util.getFirstImgSrc(dom, ".bookDetail .picb .pic");
        if (img != null) {
            return img;
        }
        let metaImg = dom.querySelector("meta[property='og:image']")?.getAttribute("content")?.trim();
        if (!metaImg) {
            return null;
        }
        return dom.baseURI ? util.resolveRelativeUrl(dom.baseURI, metaImg) : metaImg;
    }

    removeUnwantedElementsFromContentElement(element) {
        this.preparePageContent(element);
        super.removeUnwantedElementsFromContentElement(element);
    }

    cleanTitle(title) {
        if (title == null) {
            return "";
        }
        let cleaned = title
            .replace(/\s*[（(]\s*(?:第\s*)?\d+\s*\/\s*\d+\s*(?:页\s*)?[）)]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        return this.convertChineseChapterNumbers(cleaned);
    }

    convertChineseChapterNumbers(title) {
        return title.replace(
            /第([零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟萬]+)章/g,
            (match, numeral) => {
                let num = this.chineseNumeralToNumber(numeral);
                return (num !== null) ? ("第" + num + "章") : match;
            }
        );
    }

    chineseNumeralToNumber(numeral) {
        const digits = {
            "零": 0, "〇": 0,
            "一": 1, "壹": 1,
            "二": 2, "两": 2, "兩": 2, "贰": 2,
            "三": 3, "叁": 3,
            "四": 4, "肆": 4,
            "五": 5, "伍": 5,
            "六": 6, "陆": 6,
            "七": 7, "柒": 7,
            "八": 8, "捌": 8,
            "九": 9, "玖": 9
        };
        const units = {
            "十": 10, "拾": 10,
            "百": 100, "佰": 100,
            "千": 1000, "仟": 1000,
            "万": 10000, "萬": 10000
        };

        let hasUnit = [...numeral].some(ch => units[ch] !== undefined);
        if (!hasUnit) {
            let result = "";
            for (let ch of numeral) {
                if (digits[ch] === undefined) {
                    return null;
                }
                result += String(digits[ch]);
            }
            return parseInt(result, 10);
        }

        let total = 0;
        let section = 0;
        let current = null;
        let lastUnit = 0;
        let hadZero = false;

        for (let ch of numeral) {
            if (digits[ch] !== undefined) {
                let d = digits[ch];
                if (d === 0) {
                    hadZero = true;
                    current = null;
                } else {
                    if (current !== null) {
                        return null;
                    }
                    current = d;
                }
            } else if (units[ch] !== undefined) {
                let unit = units[ch];
                if (unit === 10000) {
                    section += current ?? 0;
                    if (section === 0) {
                        section = 1;
                    }
                    total += section * 10000;
                    section = 0;
                    current = null;
                    lastUnit = 10000;
                    hadZero = false;
                } else {
                    let val = current ?? 1;
                    section += val * unit;
                    current = null;
                    lastUnit = unit;
                    hadZero = false;
                }
            } else {
                return null;
            }
        }

        if (current !== null) {
            if (!hadZero && (lastUnit >= 100) && (lastUnit <= 10000)) {
                section += current * (lastUnit / 10);
            } else {
                section += current;
            }
        }
        return total + section;
    }
}

XsNetworkParser.DEFAULT_AES_KEY = "1MjESVfMv07us8KcnXmjGx0Ohnqo2VHJ";
XsNetworkParser.DEFAULT_AES_IV = "2915951533410855";

class XsNetworkErrorHandler extends FetchErrorHandler {
    constructor(parser, wrapOptions) {
        super();
        this.parser = parser;
        this.wrapOptions = wrapOptions;
    }

    getOpenUrl(url) {
        if (((url || "").includes("action=loadChapterPage") || (url || "").endsWith(".js"))
            && this.parser?.tocURL) {
            return this.parser.tocURL;
        }
        return url;
    }

    onFetchError(url, error) {
        let hostname = new URL(url).hostname;
        if (this.wrapOptions?.skipFetchRetry) {
            return Promise.reject(error);
        }
        if (HttpClient.blockedSites.has(hostname)
            || BlockedHostNames.has(hostname)
            || util.getSleepController().signal.aborted
            || (this.wrapOptions == null)) {
            return super.onFetchError(url, error);
        }

        if (this.wrapOptions.fetchRetry === undefined) {
            this.wrapOptions.fetchRetry = { retryDelay: [15, 10, 5] };
            return this.retryFetchWithState(url, this.wrapOptions, this.wrapOptions.fetchRetry);
        }

        if (0 < this.wrapOptions.fetchRetry.retryDelay.length) {
            return this.retryFetchWithState(url, this.wrapOptions, this.wrapOptions.fetchRetry);
        }

        let failError = new Error(this.makeFailMessage(url, error.message));
        let msg = new Error(this.makeFailCanRetryMessage(url, error.message));
        return this.promptUserForNetworkRetry(url, this.wrapOptions, failError, msg);
    }

    onResponseError(url, wrapOptions, response, errorMessage) {
        let failError = errorMessage
            ? new Error(errorMessage)
            : new Error(this.makeFailMessage(response.url, response.status));

        if (util.getSleepController().signal.aborted) {
            wrapOptions.skipFetchRetry = true;
            return Promise.reject(failError);
        }

        let retry = this.getRetryBehaviour(response);
        if (retry.retryDelay.length === 0) {
            wrapOptions.skipFetchRetry = true;
            return Promise.reject(failError);
        }

        if ((wrapOptions.retry === undefined)
            || ((response.status === 403) && (wrapOptions.retry.HTTP !== 403))) {
            wrapOptions.retry = retry;
            return this.retryFetchWithState(url, wrapOptions, wrapOptions.retry);
        }

        if (0 < wrapOptions.retry.retryDelay.length) {
            return this.retryFetchWithState(url, wrapOptions, wrapOptions.retry);
        }

        if (wrapOptions.retry.promptUser) {
            let effectiveResponse = {
                url: this.getOpenUrl(response.url || url),
                status: response.status
            };
            return this.promptUserForRetry(url, wrapOptions, effectiveResponse, failError)
                .catch(err => {
                    wrapOptions.skipFetchRetry = true;
                    throw err;
                });
        }
        wrapOptions.skipFetchRetry = true;
        return Promise.reject(failError);
    }

    getRetryBehaviour(response) {
        if (Array.isArray(response.retryDelay) && (response.retryDelay.length > 0)) {
            return {
                retryDelay: [...response.retryDelay],
                promptUser: true
            };
        }
        if ((response.status === 400) || (response.status === 404) || (response.status === 410)) {
            return { retryDelay: [], promptUser: false };
        }
        let retry = FetchErrorHandler.getAutomaticRetryBehaviourForStatus(response);
        if (retry.retryDelay.length === 0) {
            return {
                retryDelay: [15, 10, 5],
                promptUser: true
            };
        }
        return {
            retryDelay: [...retry.retryDelay],
            promptUser: true,
            HTTP: retry.HTTP
        };
    }

    async retryFetchWithState(url, wrapOptions, retryState) {
        let delayBeforeRetry = retryState.retryDelay.pop() * 1000;
        await util.sleep(delayBeforeRetry);
        if (util.getSleepController().signal.aborted) {
            wrapOptions.skipFetchRetry = true;
            throw new Error(this.makeFailMessage(url, "Aborted"));
        }
        wrapOptions.skipFetchRetry = false;
        return HttpClient.wrapFetchImpl(url, wrapOptions);
    }

    promptUserForNetworkRetry(url, wrapOptions, failError, msg) {
        let cancelLabel = this.getCancelButtonText();
        return new Promise((resolve, reject) => {
            msg.openurl = this.getOpenUrl(url);
            msg.blockurl = url;
            msg.retryAction = () => {
                wrapOptions.skipFetchRetry = false;
                resolve(HttpClient.wrapFetchImpl(url, wrapOptions));
            };
            msg.cancelAction = () => {
                wrapOptions.skipFetchRetry = true;
                reject(failError);
            };
            msg.cancelLabel = cancelLabel;
            ErrorLog.showErrorMessage(msg);
        });
    }
}
