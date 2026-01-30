/**
 * MihomoParty 智能链式脚本 (带注释版)
 * 核心功能：自动抓取家宽节点，挂在机场节点后面，形成链式代理，并注入到特定的策略组中。
 */

function main(config) {
    // ================= ⚙️ 用户配置区域 (只有这里需要你动) =================

    /**
     * 1. 中转组优先级列表
     * 脚本会按顺序去你的分组里找这些名字。找到第一个存在的，就把它当作“前置代理”（机场出口）。
     * 作用：决定了你的家宽节点是通过哪个组流量出去的。
     */
    const relayPriority = ["手动选择", "Hand", "节点选择", "Proxy", "代理", "自动选择", "Auto"];

    /**
     * 2. 家宽节点识别关键字 (正则表达式)
     * 你的节点名字里包含这些字，就会被脚本认作是“家宽/落地”节点，并被拿去组装。
     */
    const homeKeyword = /(家宽|住宅|ISP|Residential|落地)/i;

    /**
     * 3. 新生成的链式分组名称
     * 在你的代理面板里，那个专门用来选家宽的分组叫什么名字。
     */
    const chainGroupName = "🔗 链式家宽";

    /**
     * 4. AI 分组识别关键字
     * 如果分组名字包含这些词（如 ChatGPT），脚本会把“链式家宽”选项【置顶/默认选中】。
     */
    const aiGroupKeyword = /(AI|GPT|Claude|Gemini|Copilot|LLM)/i;

    /**
     * 5. 排除分组关键字
     * 如果分组名字包含这些词（如国内、游戏），脚本【绝对不会】把链式选项加进去。
     */
    const excludeGroupKeyword = /(国内|China|CN|Direct|直连|哔哩|Bili|Game|Steam|Download|BT)/i;

    /**
     * 6. 特殊权重关键字
     * 如果分组名字包含这些词（如 Hentai），即使它被识别为 AI 组，链式选项也强制【置底/不默认选中】。
     * 防止你看视频误用了昂贵的家宽流量。
     */
    const normalPriorityKeyword = /hentai/i;

    // ====================================================================

    // 初始化配置，防止报错
    if (!config.proxies) config.proxies = [];
    if (!config['proxy-groups']) config['proxy-groups'] = [];
    if (!config.rules) config.rules = [];
    if (!config['rule-providers']) config['rule-providers'] = {};

    // --- 步骤 1: 定位中转组 (Relay Group) ---
    // 根据 relayPriority 的顺序，找到一个真实存在的分组作为前置
    let relayGroupName = "自动选择";
    for (const keyword of relayPriority) {
        const found = config['proxy-groups'].find(g => g.name && g.name.includes(keyword));
        if (found) {
            relayGroupName = found.name;
            break;
        }
    }

    // --- 步骤 2: 抓取并改造家宽节点 ---
    // 遍历所有节点，把名字带 homeKeyword 的挑出来，设置 dialer-proxy 指向中转组
    const chainNodeNames = [];
    config.proxies.forEach(proxy => {
        if (proxy.name && homeKeyword.test(proxy.name)) {
            proxy["dialer-proxy"] = relayGroupName; // 核心：这就是“链式”的原理
            proxy["skip-cert-verify"] = true; // 跳过证书验证，防止报错
            proxy["udp"] = true; // 开启 UDP 支持
            chainNodeNames.push(proxy.name);
        }
    });

    // --- 步骤 3: 创建链式策略组 ---
    // 新建一个分组，里面包含所有改造好的家宽节点
    const groupChain = {
        name: chainGroupName,
        type: chainNodeNames.length > 0 ? "url-test" : "select",
        url: "http://www.gstatic.com/generate_204",
        interval: 300,
        tolerance: 150,
        lazy: true,
        proxies: chainNodeNames.length > 0 ? chainNodeNames : [relayGroupName]
    };

    // --- 步骤 4: 清洗原始节点 & 注入选项 ---
    config['proxy-groups'].forEach(group => {
        // 跳过链式组本身，不然自己包含自己会报错
        if (group.name === chainGroupName) return;

        if (group.proxies) {
            // 动作 A: 彻底移除原始家宽节点
            // (防止你在其他组里不小心点到原始节点，导致直连家宽而连不上)
            group.proxies = group.proxies.filter(n => !chainNodeNames.includes(n));

            if (group.type === 'select') {

                // 动作 B: 判断是否为基础组 (手动/自动/节点选择)
                // 如果是基础组，绝不注入链式选项，防止“死循环套娃”
                const isInfrastructureGroup = relayPriority.some(keyword => group.name.includes(keyword));

                if (!isInfrastructureGroup) {
                    // 动作 C: 判断是否为排除组 (国内/游戏)
                    if (!excludeGroupKeyword.test(group.name)) {
                        // 防止重复注入
                        if (!group.proxies.includes(chainGroupName)) {

                            // 动作 D: 智能排序
                            // 情况1: 是 AI 组 且 不是 Hentai -> 链式插到最前面 (默认用)
                            // 情况2: 是普通组 或 Hentai -> 链式插到最后面 (备选)
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

    // --- 步骤 5: 插入新分组 (UI 排序) ---
    // 目的是把“链式家宽”这个组，插在“自动选择”或“手动选择”的后面，方便操作
    const findIndex = (keywords) => config['proxy-groups'].findIndex(g => keywords.some(k => g.name.includes(k)));

    const manualKeywords = ["手动", "节点", "Hand", "Proxy"];
    const autoKeywords = ["自动", "Auto"];

    // 优先找"自动选择"，找不到就找"手动选择"，都找不到就插在最前面
    let anchorIndex = findIndex(autoKeywords);
    if (anchorIndex === -1) {
        anchorIndex = findIndex(manualKeywords);
    }

    const insertPos = anchorIndex !== -1 ? anchorIndex + 1 : 0;

    // 执行插入 (不改变原有的手动/自动排序)
    config['proxy-groups'].splice(insertPos, 0, groupChain);

    // --- 步骤 6: 修复规则源 (Rule Providers) ---
    // 添加 OpenAI, Gemini, Claude 等规则集
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

    // --- 步骤 7: 注入强制规则 ---
    // 强制 ChatGPT 客户端和各大 AI 网站走链式代理
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

    // 把这些规则插到列表最前面，保证优先级最高
    config.rules = [...aiRules, ...config.rules];

    return config;
}

