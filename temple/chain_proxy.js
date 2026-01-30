function main(config) {
    // ================= 配置区域 =================
    const relayPriority = ["手动选择", "Hand", "节点选择", "Proxy", "代理", "自动选择", "Auto"];
    const homeKeyword = /(家宽|住宅|ISP|Residential|落地)/i;
    const chainGroupName = "🔗 链式家宽";

    const aiGroupKeyword = /(AI|GPT|Claude|Gemini|Copilot|LLM)/i;
    const excludeGroupKeyword = /(国内|China|CN|Direct|直连|哔哩|Bili|Game|Steam|Download|BT)/i;
    // 特殊关键字：包含这些词的组，强制把链式选项放到后面
    const normalPriorityKeyword = /hentai/i;

    // ===========================================

    if (!config.proxies) config.proxies = [];
    if (!config['proxy-groups']) config['proxy-groups'] = [];
    if (!config.rules) config.rules = [];
    if (!config['rule-providers']) config['rule-providers'] = {};

    // 1. 定位中转组 (作为前置代理)
    let relayGroupName = "自动选择";
    for (const keyword of relayPriority) {
        const found = config['proxy-groups'].find(g => g.name && g.name.includes(keyword));
        if (found) {
            relayGroupName = found.name;
            break;
        }
    }

    // 2. 抓取家宽节点 & 设置前置
    const chainNodeNames = [];
    config.proxies.forEach(proxy => {
        if (proxy.name && homeKeyword.test(proxy.name)) {
            proxy["dialer-proxy"] = relayGroupName;
            proxy["skip-cert-verify"] = true;
            proxy["udp"] = true;
            chainNodeNames.push(proxy.name);
        }
    });

    // 3. 创建链式策略组
    const groupChain = {
        name: chainGroupName,
        type: chainNodeNames.length > 0 ? "url-test" : "select",
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 150,
        lazy: true,
        proxies: chainNodeNames.length > 0 ? chainNodeNames : [relayGroupName]
    };

    // 4. 清洗原始节点 & 注入选项
    config['proxy-groups'].forEach(group => {
        if (group.name === chainGroupName) return;

        if (group.proxies) {
            // 彻底移除原始家宽节点
            group.proxies = group.proxies.filter(n => !chainNodeNames.includes(n));

            if (group.type === 'select') {
                if (group.name !== relayGroupName) {
                    if (!excludeGroupKeyword.test(group.name)) {
                        if (!group.proxies.includes(chainGroupName)) {

                            // 逻辑：AI组且非Hentai -> 放前面；其他 -> 放后面
                            if (aiGroupKeyword.test(group.name) && !normalPriorityKeyword.test(group.name)) {
                                group.proxies.unshift(chainGroupName);
                            } else {
                                group.proxies.push(chainGroupName);
                            }
                        }
                    }
                }
            }
        }
    });

    // 5. 强制排序 (节点 > 自动 > 链式)
    const findIndex = (keywords) => config['proxy-groups'].findIndex(g => keywords.some(k => g.name.includes(k)));

    const manualKeywords = ["手动", "节点", "Hand", "Proxy"];
    const autoKeywords = ["自动", "Auto"];

    let manualIndex = findIndex(manualKeywords);
    let autoIndex = findIndex(autoKeywords);

    // 排序A: 自动 放到 手动 后面
    if (manualIndex !== -1 && autoIndex !== -1) {
        const autoGroup = config['proxy-groups'][autoIndex];
        config['proxy-groups'].splice(autoIndex, 1);
        manualIndex = findIndex(manualKeywords);
        config['proxy-groups'].splice(manualIndex + 1, 0, autoGroup);
        autoIndex = manualIndex + 1;
    }

    // 排序B: 插入链式组 (锚点在自动选择后面)
    let anchorIndex = autoIndex;
    if (anchorIndex === -1) anchorIndex = manualIndex;
    const insertPos = anchorIndex !== -1 ? anchorIndex + 1 : 0;

    config['proxy-groups'].splice(insertPos, 0, groupChain);

    // 6. 修复规则源
    const fixedProviders = {
        "OpenAI": {
            type: "http",
            behavior: "classical",
            format: "yaml",
            url: "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/OpenAI.yaml",
            path: "./rules/OpenAI.yaml",
            interval: 86400
        },
        "Gemini": {
            type: "http",
            behavior: "classical",
            format: "yaml",
            url: "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Gemini.yaml",
            path: "./rules/Gemini.yaml",
            interval: 86400
        },
        "Claude": {
            type: "http",
            behavior: "classical",
            format: "yaml",
            url: "https://cdn.jsdelivr.net/gh/zuluion/Clash-Template-Config@master/Filter/Claude.yaml",
            path: "./rules/Claude.yaml",
            interval: 86400
        },
        "ChinaDomain": {
            type: "http",
            behavior: "domain",
            url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaDomain.list",
            path: "./rules/ChinaDomain.list",
            interval: 86400
        },
        "ChinaCompanyIp": {
            type: "http",
            behavior: "ipcidr",
            url: "https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/ChinaCompanyIp.list",
            path: "./rules/ChinaCompanyIp.list",
            interval: 86400
        }
    };
    Object.assign(config['rule-providers'], fixedProviders);

    // 7. 注入 AI 规则
    const aiRules = [
    `PROCESS-NAME,ChatGPT.exe,${chainGroupName}`,
    `PROCESS-NAME,ChatGPT,${chainGroupName}`,
    `RULE-SET,OpenAI,${chainGroupName}`,
    `RULE-SET,Gemini,${chainGroupName}`,
    `RULE-SET,Claude,${chainGroupName}`,
    `DOMAIN-SUFFIX,oaistatic.com,${chainGroupName}`,
    `DOMAIN-SUFFIX,cdn.oaistatic.com,${chainGroupName}`,
    `DOMAIN-SUFFIX,gstatic.com,${chainGroupName}`
  ];

    config.rules = [...aiRules, ...config.rules];

    return config;
}

