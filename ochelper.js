// ==UserScript==
// @name         Torn Crime Position Validator
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Highlights faction crime positions by tracking crime names in text order with side tooltips
// @match        https://www.torn.com/factions.php?step=your*
// @grant        none
// @author       V3n [42214]
// ==/UserScript==

(function () {
    'use strict';

    /**************** CONFIG ****************/
    const thresholds = __CPR_MINS__;

    const crimeNames = Object.keys(thresholds);

    /**************** UI HELPERS ****************/
    function makeCircle(currentValue, required) {
        const c = document.createElement('span');
        c.className = 'tm-circle';

        let color = 'red'; // default fail
        if (required === "always" || currentValue >= required) {
            color = 'green';
        } else if (Math.abs(currentValue - required) <= 3) {
            color = 'yellow'; // close
        }

        c.style.cssText = `
            display:inline-block;
            width:12px;
            height:12px;
            border-radius:50%;
            margin-left:6px;
            vertical-align:middle;
            background:${color};
        `;
        return c;
    }

    function attachSideTooltip(target, text) {
        const tooltip = document.createElement('div');
        tooltip.textContent = text;
        tooltip.style.cssText = `
            position:absolute;
            background:#000;
            color:#fff;
            padding:3px 6px;
            font-size:11px;
            border-radius:4px;
            white-space:nowrap;
            z-index:99999;
            display:none;
            pointer-events:none;
        `;
        document.body.appendChild(tooltip);

        target.addEventListener('mouseenter', () => {
            const rect = target.getBoundingClientRect();
            tooltip.style.left = (rect.right + 10 + window.scrollX) + 'px';
            tooltip.style.top = (rect.top + window.scrollY + 2) + 'px';
            tooltip.style.display = 'block';
        });

        target.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    }

    /**************** CORE LOGIC ****************/
    function processPage() {
        let currentCrime = null;

        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const t = node.textContent.trim();
                    return t ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        while (walker.nextNode()) {
            const node = walker.currentNode;
            const text = node.textContent.trim();

            // Detect crime name
            if (crimeNames.includes(text)) {
                currentCrime = text;
                continue;
            }

            if (!currentCrime) continue;

            const crimeRoles = thresholds[currentCrime];
            if (!crimeRoles || !(text in crimeRoles)) continue;

            const valueElem = node.parentElement?.nextElementSibling;
            if (!valueElem) continue;
            if (valueElem.querySelector('.tm-circle')) continue;

            const currentValue = parseInt(valueElem.textContent.trim(), 10);
            const required = crimeRoles[text];

            const circle = makeCircle(currentValue, required);

            attachSideTooltip(
                circle,
                required === "always"
                    ? "Always allowed"
                    : `Required: ${required}, Current: ${currentValue}`
            );

            valueElem.appendChild(circle);
        }
    }

    /**************** OBSERVER ****************/
    const observer = new MutationObserver(() => processPage());
    observer.observe(document.body, { childList: true, subtree: true });

    processPage();
})();