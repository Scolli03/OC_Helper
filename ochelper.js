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
    const thresholds = {
        "Blast from the Past": {
            "Picklock #1": 70,
            "Picklock #2": 10,
            "Bomber": 70,
            "Muscle": 70,
            "Hacker": 70,
            "Engineer": 70
        },
        "Clinical Precision": {
            "Cat Burglar": 65,
            "Assassin": 65,
            "Cleaner": 65,
            "Imitator": 70
        },
        "Break the Bank": {
            "Thief #1": 60,
            "Robber": 60,
            "Thief #2": 65,
            "Muscle #1": 65,
            "Muscle #2": 60,
            "Muscle #3": 65
        },
        "Stacking the Deck": {
            "Driver": 56,
            "Hacker": 70,
            "Cat Burglar": 70,
            "Imitator": 70
        },
        "Ace in the Hole": {
            "Hacker": 61,
            "Muscle #1": 61,
            "Driver": 55,
            "Muscle #2": 61,
            "Imitator": 61
        },
        "Manifest Cruelty": {
            "Cat Burglar": 70,
            "Interrogator": 70,
            "Hacker": 70,
            "Reviver": 70
        },
        "Gone Fission": {
            "Pickpocket": 61,
            "Bomber": 61,
            "Engineer": 61,
            "Hijacker": 55,
            "Imitator": 61
        },
        "Crane Reaction": {
            "Sniper": 57,
            "Bomber": 57,
            "Engineer": 57,
            "Lookout": 57,
            "Muscle #1": 57,
            "Muscle #2": 57
        },
        "Mob Mentality": {
            "Looter #1": 70,
            "Looter #2": 70,
            "Looter #3": 70,
            "Looter #4": 70
        },
        "Pet Project": {
            "Kidnapper": 70,
            "Muscle": 70,
            "Picklock": 70
        },
        "Cash Me If You Can": {
            "Thief #1": 70,
            "Thief #2": 70,
            "Lookout": 70
        },
        "Best of the Lot": {
            "Picklock": 70,
            "Car Thief": 70,
            "Muscle": 70,
            "Impersonator": 70
        },
        "Smoke and Wing Mirrors": {
            "Car Thief": 70,
            "Imitator": 70,
            "Hustler #1": 70,
            "Hustler #2": 70
        },
        "Market Forces": {
            "Enforcer": 70,
            "Negotiator": 70,
            "Lookout": 70,
            "Arsonist": 70,
            "Muscle": 70
        },
        "Gaslight the Way": {
            "Imitator #1": 70,
            "Imitator #2": 70,
            "Imitator #3": 70,
            "Looter #1": 70,
            "Looter #2": 70,
            "Looter #3": 70
        },
        "Snow Blind": {
            "Hustler": 70,
            "Impersonator": 70,
            "Muscle #1": 70,
            "Muscle #2": 70
        },
        "Stage Fright": {
            "Enforcer": 70,
            "Muscle #1": 70,
            "Muscle #2": 70,
            "Muscle #3": 70,
            "Lookout": 70,
            "Sniper": 70
        },
        "Guardian Angels": {
            "Enforcer": 70,
            "Hustler": 70,
            "Engineer": 70
        },
        "Leave No Trace": {
            "Techie": 70,
            "Negotiator": 70,
            "Imitator": 70
        },
        "Counter Offer": {
            "Robber": 70,
            "Looter": 70,
            "Hacker": 70,
            "Picklock": 70,
            "Engineer": 70
        },
        "No Reserve": {
            "Car Thief": 70,
            "Techie": 70,
            "Engineer": 70
        },
        "Bidding War": {
            "Bomber #1": 70,
            "Robber #1": 70,
            "Robber #2": 70,
            "Robber #3": 70,
            "Bomber #2": 70,
            "Driver": 70
        },
        "Honey Trap": {
            "Muscle #1": 70,
            "Enforcer": 70,
            "Muscle #2": 70
        },
        "Sneaky Git Grab": {
            "Imitator": 70,
            "Pickpocket": 70,
            "Hacker": 70,
            "Techie": 70
        }
    };

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