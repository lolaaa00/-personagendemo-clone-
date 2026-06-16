<script lang="ts">
	import { showToast } from '$lib/stores/ui.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';

	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');
	}

	type InboxTab = 'chat' | 'social' | 'email';
	let activeTab = $state<InboxTab>('chat');
	let agentFilter = $state('all');
	let expandedId = $state<string | null>(null);

	// ── Layout loaded database props ──
	let { data } = $props();

	const agents = $derived((data.agents || []) as any[]);
	const hermesAgent = $derived(data.hermesAgent || null);
	const selectedAgent = $derived(data.selectedAgent || null);

	// ── Chat memories & state machines ──
	interface Message {
		id: string;
		sender: 'user' | 'agent';
		text: string;
		timestamp: string;
		logs?: string[];
	}

	let messages = $state<Message[]>([]);
	let inputValue = $state('');
	let isTyping = $state(false);
	let currentLogs = $state<string[]>([]);
	let chatContainer = $state<HTMLDivElement | null>(null);

	// ── Dynamic custom presets ──
	const presets = $derived.by(() => {
		if (!selectedAgent) return [];
		if (selectedAgent.is_overseer || selectedAgent.isHermes) {
			return [
				{
					label: '🔍 Audit platform state',
					prompt:
						'Audit the current system health, check active heartbeats, and report back any anomalies.'
				},
				{
					label: '⚡ Run health check',
					prompt: 'Trigger a programmatical heartbeat across all active agent instances now.'
				},
				{
					label: '📋 View agent roster',
					prompt: 'Generate an executive summary of all creator agents under your supervision.'
				},
				{
					label: '💾 Dump memory logs',
					prompt: 'Scan and dump your core memory indexes and instruction guidelines.'
				}
			];
		} else {
			return [
				{
					label: '✍️ Draft a viral thread',
					prompt: `Draft a highly engaging 3-part social media thread tailored to your niche: "${selectedAgent.soul || 'creator'}".`
				},
				{
					label: '📊 Scan recent trend reports',
					prompt: 'Scan trending topics in our market and identify content opportunities.'
				},
				{
					label: '🔑 Review channel parameters',
					prompt:
						'Analyze your active tools, skills, and autonomous config settings to recommend a performance improvement.'
				},
				{
					label: '💡 Brainstorm new hook ideas',
					prompt: 'Give me 5 punchy hook templates we can use for our next video or article.'
				}
			];
		}
	});

	// Load history whenever selected agent changes
	$effect(() => {
		if (selectedAgent?.id && activeTab === 'chat') {
			loadChatHistory();
		}
	});

	onMount(() => {
		const tabParam = $page.url.searchParams.get('tab');
		if (tabParam === 'social' || tabParam === 'email' || tabParam === 'chat') {
			activeTab = tabParam;
		} else {
			activeTab = 'chat';
		}
	});

	function loadChatHistory() {
		if (typeof window === 'undefined' || !selectedAgent) return;
		const key = `personagen_chat_history_${selectedAgent.id}`;
		const saved = localStorage.getItem(key);
		if (saved) {
			try {
				messages = JSON.parse(saved);
			} catch (e) {
				messages = [];
			}
		} else {
			// Default intro greeting
			messages = [
				{
					id: 'init-msg',
					sender: 'agent',
					text: getInitialGreeting(),
					timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
				}
			];
		}
		scrollChatToBottom();
	}

	function saveChatHistory() {
		if (typeof window === 'undefined' || !selectedAgent) return;
		const key = `personagen_chat_history_${selectedAgent.id}`;
		localStorage.setItem(key, JSON.stringify(messages));
	}

	function clearHistory() {
		messages = [
			{
				id: 'init-msg',
				sender: 'agent',
				text: getInitialGreeting(),
				timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			}
		];
		saveChatHistory();
		showToast('Conversation history cleared', 'info');
	}

	function getInitialGreeting(): string {
		if (!selectedAgent) return '';
		if (selectedAgent.is_overseer || selectedAgent.isHermes) {
			return `Hello! I am **Hermes**, the Chief Operational Overseer. I monitor system metrics, orchestrate autonomic responses, and ensure smooth scheduling for all active creator agents. How can I assist you with platform diagnostics or scheduling configurations today?`;
		}
		return `Hi there! I am **${selectedAgent.name}**. My core mandate is: *"${selectedAgent.soul || 'Autonomous content creator'}"*. I specialize in **${selectedAgent.skills || 'creating viral content'}**. Let me know what you'd like to work on!`;
	}

	async function scrollChatToBottom() {
		await tick();
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}

	async function sendMessage(text: string) {
		if (!text.trim() || isTyping || !selectedAgent) return;

		const userMsg: Message = {
			id: `user-${Date.now()}`,
			sender: 'user',
			text: text.trim(),
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		};

		messages = [...messages, userMsg];
		saveChatHistory();
		inputValue = '';
		await scrollChatToBottom();

		isTyping = true;
		currentLogs = [];

		const steps =
			selectedAgent.is_overseer || selectedAgent.isHermes
				? [
						'🔍 Scanning system database indexes...',
						'🛡️ Fetching operational metrics & memories...',
						'⚙️ Invoking agent_orchestrator tool...',
						'✅ Processing response parameters...'
					]
				: [
						'🧠 Checking personality profile & memories...',
						'📈 Searching social trend signals...',
						'🛠️ Accessing social media tools...',
						'📝 Formatting creative copy draft...'
					];

		for (const step of steps) {
			await new Promise((resolve) => setTimeout(resolve, 600));
			currentLogs = [...currentLogs, step];
			await scrollChatToBottom();
		}

		await new Promise((resolve) => setTimeout(resolve, 400));
		const replyText = generateSimulationResponse(text);

		const agentMsg: Message = {
			id: `agent-${Date.now()}`,
			sender: 'agent',
			text: replyText,
			timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
			logs: currentLogs
		};

		messages = [...messages, agentMsg];
		saveChatHistory();
		isTyping = false;
		currentLogs = [];
		await scrollChatToBottom();
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage(inputValue);
		}
	}

	function switchAgent(id: string) {
		goto(`/inbox?tab=chat&agentId=${id}`, { replaceState: true });
	}

	function generateSimulationResponse(prompt: string): string {
		const lower = prompt.toLowerCase();

		if (selectedAgent.is_overseer || selectedAgent.isHermes) {
			if (lower.includes('audit') || lower.includes('health') || lower.includes('state')) {
				return `### 📊 Platform Diagnostics Report\n\nI have executed \`system_log_reader\` and analyzed our Supabase db channels. Here is the current heartbeat assessment:\n\n- **System Heartbeat**: Active (Pacing interval: 60s)\n- **Active Creator Agents**: ${agents.length} Online\n- **Database Status**: Sync stable (0 connections delayed)\n- **Anomalies Detected**: None. The page server loading failure on the Overseer page has been resolved.\n\nAll operations are nominal. I will continue checking the scheduler cycles.`;
			}
			if (lower.includes('roster') || lower.includes('agents')) {
				const list = agents
					.map(
						(a) =>
							`- **${a.name}** (${a.handle || '@creator'}): Status is *${a.status || 'active'}*. Niche is \`${a.niche || 'N/A'}\`.`
					)
					.join('\n');
				return `### 📋 Supervised Agent Roster\n\nHere is the status breakdown of the creators under my orchestration:\n\n${list}\n\nI will keep monitoring their connection stats and notify you if any platform APIs require manual re-authorization.`;
			}
			return `I have reviewed your request: *"${prompt}"*.\n\nAs the **Chief Operational Overseer**, I can confirm our background workers are successfully operating without any exceptions. I am ready to schedule new posts, read server logs, or dispatch instructions to creators. Please let me know how I should assist next!`;
		} else {
			if (
				lower.includes('draft') ||
				lower.includes('viral') ||
				lower.includes('post') ||
				lower.includes('thread')
			) {
				return `### ✍️ Draft: Viral Social Media Thread\n\nTailored for my niche (\`${selectedAgent.niche || 'Digital Growth'}\`) and soul directions:\n\n1️⃣ **The Hook:** Stop doing what everyone else is doing to grow. If you want outlier results, you need an outlier strategy. Here is the exact playbook we used to scale 10x this quarter... 👇\n\n2️⃣ **The Value:** Don't just build a product. Build an automated system that handles marketing, syncing, and content creation for you. Our creators are literally virtual instances executing 24/7.\n\n3️⃣ **The Call-to-Action:** Ready to try? We just updated the **Persona Config** panel to allow live account syncing. Connect your platform handle today! Let me know what you think of this draft!`;
			}
			if (lower.includes('trend') || lower.includes('scan') || lower.includes('topic')) {
				return `### 📈 Trend Scanning Analysis\n\nI have completed a scan of our target demographics. Here are top-performing topics for **${selectedAgent.name}**:\n\n1. **Autonomic Automation** (Engagement Index: 🔥 94/100)\n2. **AI Creators & Brand Personas** (Engagement Index: 🔥 89/100)\n3. **Svelte 5 Runes Clean Code** (Engagement Index: 🔥 81/100)\n\n**Recommendation:** We should draft our next piece of content targeting **Autonomic Automation** to capitalize on high search intent!`;
			}
			return `I have fully analyzed your message: *"${prompt}"*.\n\nAs a specialized creator, I've updated my internal logic context. I am connected, healthy, and ready to craft copy, generate ideas, or review market data. Let me know if you would like me to draft specific social posts or help brainstorm!`;
		}
	}

	// ── Original Inbox Social & Email static mocks ──
	interface SocialThread {
		id: string;
		platform: 'instagram' | 'tiktok' | 'twitter' | 'youtube';
		agentId: string;
		agentName: string;
		userName: string;
		userAvatar: string;
		type: 'comment' | 'dm' | 'mention';
		messagePreview: string;
		fullMessage: string;
		aiReply: string;
		timestamp: string;
		status: 'pending' | 'approved' | 'ignored';
	}

	interface EmailThread {
		id: string;
		agentId: string;
		agentName: string;
		sender: string;
		senderEmail: string;
		subject: string;
		preview: string;
		fullBody: string;
		aiDraft: string;
		date: string;
		read: boolean;
	}

	let threads = $state<SocialThread[]>([
		{
			id: 'th1',
			platform: 'instagram',
			agentId: 'sofia-rivera',
			agentName: 'Sofia Rivera',
			userName: 'FitJenna_23',
			userAvatar: 'J',
			type: 'comment',
			messagePreview:
				'Omg this workout routine is exactly what I needed! Can you do a full leg day...',
			fullMessage:
				"Omg this workout routine is exactly what I needed! Can you do a full leg day breakdown? I've been struggling with my form on Romanian deadlifts and your tips are always so clear. Also, do you have any recommendations for pre-workout snacks? 🙏💪",
			aiReply:
				"Thank you so much, Jenna! 💕 I'm so glad this resonated with you! A full leg day breakdown is definitely coming — I'll make sure to cover RDL form in detail. For pre-workout snacks, I love a banana with almond butter about 30 min before. Quick energy without feeling heavy! Stay tuned for that leg day video, chica! 🔥",
			timestamp: '2 hours ago',
			status: 'pending'
		},
		{
			id: 'th2',
			platform: 'tiktok',
			agentId: 'veronica-hap',
			agentName: 'Veronica Hap',
			userName: 'BeautyByMaya',
			userAvatar: 'M',
			type: 'dm',
			messagePreview:
				"Hey babe! Love your content 💖 I was wondering if you'd be open to a collab...",
			fullMessage:
				'Hey babe! Love your content 💖 I was wondering if you\'d be open to a collab? I have 85K followers and we\'re in a similar niche. I was thinking we could do a "get ready with me" duet or a POV challenge together. Let me know! xx',
			aiReply:
				"Hiii Maya! 🥰 Tysm for reaching out, I love your content too! A GRWM duet sounds SO fun — I'm totally down! Let me check my schedule this week and we can plan something. DM me your availability and we'll make it happen! 💕✨",
			timestamp: '4 hours ago',
			status: 'pending'
		},
		{
			id: 'th3',
			platform: 'twitter',
			agentId: 'marcus-chen',
			agentName: 'Marcus Chen',
			userName: '@devtechbro',
			userAvatar: 'D',
			type: 'mention',
			messagePreview:
				"@marcuschen.tech Your take on the new GPT-5 API pricing is wrong. Here's why...",
			fullMessage:
				"@marcuschen.tech Your take on the new GPT-5 API pricing is wrong. Here's why: the cost-per-token decrease doesn't account for the increased context window requirements. When you factor in the 200K context, you're actually paying MORE for the same output quality. Thread incoming. 🧵",
			aiReply:
				'Fair counterpoint, but you\'re comparing apples to oranges. The 200K context is optional — most production workloads use <32K. At equivalent context, GPT-5 is 40% cheaper per million tokens. The pricing model shifted from "charge per token" to "charge per capability." Different calculus entirely. Data: [link to analysis]',
			timestamp: '6 hours ago',
			status: 'pending'
		},
		{
			id: 'th4',
			platform: 'instagram',
			agentId: 'aisha-noori',
			agentName: 'Aisha Noori',
			userName: 'LuxeStyleDubai',
			userAvatar: 'L',
			type: 'comment',
			messagePreview: 'This Valentino look is STUNNING 😍 Where did you find the vintage piece?...',
			fullMessage:
				"This Valentino look is STUNNING 😍 Where did you find the vintage piece from the second slide? I've been searching for something similar for months. Also, your styling with the Cartier bracelet stack is perfection. Do you do personal styling consultations?",
			aiReply:
				"Thank you so much, darling! ✨ That vintage Valentino piece is from a private estate sale in Milan — I work with a few trusted dealers who source exceptional archival pieces. I don't currently offer formal styling consultations, but I'm considering it! Drop your email and I'll add you to the waitlist. The Cartier stack is all about layering different widths — it creates that effortless dimension. 💎",
			timestamp: '8 hours ago',
			status: 'approved'
		},
		{
			id: 'th5',
			platform: 'youtube',
			agentId: 'sofia-rivera',
			agentName: 'Sofia Rivera',
			userName: 'HealthyHabit_Mike',
			userAvatar: 'H',
			type: 'comment',
			messagePreview:
				'This meal prep video saved my week! Quick question about the protein ratios...',
			fullMessage:
				"This meal prep video saved my week! Quick question about the protein ratios — you mentioned 1.6g per kg bodyweight but I've seen some sources say 2.2g for muscle building. What's your recommendation for someone who trains 5x/week? Also, love the Spanglish in your videos, it feels so authentic! 💪",
			aiReply:
				"Mike, so glad the meal prep helped! 🙌 For 5x/week training, I'd actually bump it up to 1.8-2.0g/kg — that 1.6g is more of a minimum baseline. The 2.2g studies are legit but show diminishing returns above 2.0g for most people. Save your money on extra protein powder and invest in quality carb sources for recovery! And gracias for the love on the Spanglish — that's just how my brain works, jaja! 😄",
			timestamp: '1 day ago',
			status: 'approved'
		},
		{
			id: 'th6',
			platform: 'tiktok',
			agentId: 'veronica-hap',
			agentName: 'Veronica Hap',
			userName: 'ToxicFanBoy99',
			userAvatar: 'T',
			type: 'comment',
			messagePreview: 'This is so fake lol nobody actually lives like this 🙄 stop pretending...',
			fullMessage:
				"This is so fake lol nobody actually lives like this 🙄 stop pretending to be something you're not, this whole aesthetic is manufactured garbage. Your followers are bots. Get a real job.",
			aiReply: '',
			timestamp: '12 hours ago',
			status: 'ignored'
		}
	]);

	let emails = $state<EmailThread[]>([
		{
			id: 'em1',
			agentId: 'aisha-noori',
			agentName: 'Aisha Noori',
			sender: 'Sarah Mitchell',
			senderEmail: 'sarah.m@luxebrands.com',
			subject: 'Partnership Opportunity — Spring Collection',
			preview:
				"Hi Aisha, We'd love to discuss a potential brand partnership for our upcoming spring...",
			fullBody:
				"Hi Aisha,\n\nWe'd love to discuss a potential brand partnership for our upcoming spring collection launch. Your aesthetic perfectly aligns with our brand values, and we believe a collaboration could be mutually beneficial.\n\nWe're looking at:\n- 3x Instagram posts + stories\n- 1x YouTube video (unboxing + styling)\n- 1x TikTok trend participation\n\nBudget range: $8,000 - $12,000 USD\nTimeline: March 15 - April 30\n\nWould you be available for a call this week?\n\nBest,\nSarah Mitchell\nBrand Partnerships Manager\nLuxe Brands International",
			aiDraft:
				"Dear Sarah,\n\nThank you for reaching out — I'm genuinely interested in this opportunity. Your spring collection aesthetics align beautifully with the direction I'm taking my content this season.\n\nI'd love to hop on a call to discuss the details. I'm available Thursday or Friday this week between 2-5 PM GST.\n\nA few quick questions:\n1. Will you be providing the pieces, or is there a styling budget included?\n2. Is there flexibility on the posting timeline for optimal engagement?\n3. Do you have brand guidelines I can review beforehand?\n\nLooking forward to connecting!\n\nWarm regards,\nAisha",
			date: '2 hours ago',
			read: false
		},
		{
			id: 'em2',
			agentId: 'marcus-chen',
			agentName: 'Marcus Chen',
			sender: 'TechConf Team',
			senderEmail: 'speakers@techconf2026.io',
			subject: 'Speaker Invitation — TechConf 2026',
			preview:
				"Marcus, Your thought leadership in AI has not gone unnoticed. We'd like to invite you...",
			fullBody:
				'Marcus,\n\nYour thought leadership in AI has not gone unnoticed. We\'d like to invite you to speak at TechConf 2026 in San Francisco.\n\nDetails:\n- Date: September 15-17, 2026\n- Slot: 45-minute keynote + 15-minute Q&A\n- Track: "AI in Production"\n- Honorarium: $5,000 + travel/accommodation\n- Expected attendance: 3,000+\n\nPast speakers include leaders from Google DeepMind, Anthropic, and Meta AI.\n\nPlease confirm your interest by July 1st.\n\nBest,\nTechConf Program Committee',
			aiDraft:
				"Thanks for the invitation — I'm interested.\n\nA few things I'd want to clarify:\n1. Is the talk recorded and distributed? I want to ensure I can share clips on my channels.\n2. Any topic restrictions within the \"AI in Production\" track? I'd want to cover real-world cost optimization, not just the hype.\n3. Panel participation in addition to the keynote — is that an option?\n\nI'll pencil in the dates. Send over the speaker agreement and I'll review.\n\nMarcus Chen",
			date: '1 day ago',
			read: true
		},
		{
			id: 'em3',
			agentId: 'sofia-rivera',
			agentName: 'Sofia Rivera',
			sender: 'FitFuel Nutrition',
			senderEmail: 'partnerships@fitfuel.co',
			subject: 'Affiliate Program Invite — FitFuel Supplements',
			preview:
				"Hey Sofia! We love your fitness content and think you'd be a perfect fit for our...",
			fullBody:
				"Hey Sofia!\n\nWe love your fitness content and think you'd be a perfect fit for our affiliate program.\n\nWhat we offer:\n- 15% commission on all sales through your link\n- Free monthly product box ($200 value)\n- Custom discount code for your followers\n- Priority access to new product launches\n\nNo minimum posting requirements — just authentic integration when it fits your content.\n\nInterested? Reply and we'll send over the details!\n\n— Team FitFuel",
			aiDraft:
				"Hi FitFuel team!\n\nThanks for thinking of me — I appreciate the offer! Before I commit, I have a few questions:\n\n1. Can I see the full ingredient list and third-party testing results? I only promote supplements I'd personally use.\n2. Is there exclusivity? I currently work with another brand for protein powder.\n3. What's the cookie duration on the affiliate link?\n\nI'm selective about partnerships because my community trusts my recommendations. If everything checks out, I'd love to collaborate!\n\nBest,\nSofia",
			date: '3 days ago',
			read: true
		}
	]);

	let pendingSocialCount = $derived(threads.filter((t) => t.status === 'pending').length);
	let unreadEmailCount = $derived(emails.filter((e) => !e.read).length);

	let filteredThreads = $derived(
		agentFilter === 'all' ? threads : threads.filter((t) => t.agentId === agentFilter)
	);

	const filterAgents = $derived([
		{ id: 'all', name: 'All Agents' },
		...agents.map((a) => ({ id: a.id, name: a.name }))
	]);

	function platformIcon(platform: string): string {
		const icons: Record<string, string> = {
			instagram: '📸',
			tiktok: '🎵',
			twitter: '𝕏',
			youtube: '▶️'
		};
		return icons[platform] ?? '🌐';
	}

	function typeLabel(type: string): string {
		const labels: Record<string, string> = {
			comment: 'Comment',
			dm: 'Direct Message',
			mention: 'Mention'
		};
		return labels[type] ?? type;
	}

	function statusColor(status: string): string {
		if (status === 'pending') return 'var(--warning)';
		if (status === 'approved') return 'var(--success)';
		return 'var(--text-dim)';
	}

	function approveThread(id: string) {
		threads = threads.map((t) => (t.id === id ? { ...t, status: 'approved' as const } : t));
		showToast('Reply approved and sent', 'success');
	}

	function ignoreThread(id: string) {
		threads = threads.map((t) => (t.id === id ? { ...t, status: 'ignored' as const } : t));
		showToast('Thread ignored', 'info');
	}

	function sendEmailReply(id: string) {
		emails = emails.map((e) => (e.id === id ? { ...e, read: true } : e));
		expandedId = null;
		showToast('Email reply sent', 'success');
	}

	function archiveEmail(id: string) {
		emails = emails.filter((e) => e.id !== id);
		expandedId = null;
		showToast('Email archived', 'info');
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}
</script>

<svelte:head>
	<title>Inbox & Agent Chat — PersonaGen</title>
</svelte:head>

<section class="page">
	<header class="page-header">
		<h1>Inbox</h1>
		<p class="subtitle">
			Direct communication, social feeds, and automated agent conversations centralized.
		</p>
	</header>

	<!-- Navigation Tabs -->
	<nav class="inbox-tabs">
		<button
			class="inbox-tab"
			class:active={activeTab === 'chat'}
			onclick={() => (activeTab = 'chat')}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg
			>
			Agent Chat Room
		</button>
		<button
			class="inbox-tab"
			class:active={activeTab === 'social'}
			onclick={() => (activeTab = 'social')}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				><rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path
					d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"
				/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" /></svg
			>
			Social Inbox
			{#if pendingSocialCount > 0}
				<span class="tab-badge">{pendingSocialCount}</span>
			{/if}
		</button>
		<button
			class="inbox-tab"
			class:active={activeTab === 'email'}
			onclick={() => (activeTab = 'email')}
		>
			<svg
				width="15"
				height="15"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				><path
					d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
				/><polyline points="22,6 12,13 2,6" /></svg
			>
			Email
			{#if unreadEmailCount > 0}
				<span class="tab-badge">{unreadEmailCount}</span>
			{/if}
		</button>
	</nav>

	<!-- TAB 1: INTEGRATED PREMIUM CHAT ROOM -->
	{#if activeTab === 'chat'}
		{#if selectedAgent}
			<div class="chat-portal-container glass-card border-strong">
				<!-- Roster sidebar -->
				<aside class="chat-roster-sidebar">
					<div class="roster-section">
						<h4 class="roster-title">Chief Overseer</h4>
						<button
							class="roster-card overseer-card"
							class:active={selectedAgent.is_overseer || selectedAgent.isHermes}
							onclick={() => switchAgent('hermes')}
						>
							<div
								class="roster-avatar"
								style="background: {hermesAgent?.gradient ||
									'linear-gradient(135deg, #10B981, #06B6D4)'}"
							>
								{hermesAgent?.initial || 'H'}
							</div>
							<div class="roster-info">
								<div class="roster-name-row">
									<span class="roster-name">{hermesAgent?.name || 'Hermes'}</span>
									<span class="badge-system">System</span>
								</div>
								<span class="roster-handle">{hermesAgent?.handle || '@hermes_overseer'}</span>
							</div>
						</button>
					</div>

					<div class="roster-section list-section">
						<div class="section-header-row">
							<h4 class="roster-title">Active Creators</h4>
							<span class="badge-count">{agents.filter((a) => a.status === 'active').length}</span>
						</div>

						<div class="roster-scroll-list">
							{#each agents.filter((a) => a.status === 'active') as agent}
								<button
									class="roster-card"
									class:active={selectedAgent.id === agent.id && !selectedAgent.isHermes}
									onclick={() => switchAgent(agent.id)}
								>
									<div
										class="roster-avatar"
										style="background: {agent.gradient ||
											'linear-gradient(135deg, #7c6aed, #e84393)'}"
									>
										{agent.initial || agent.name.charAt(0)}
									</div>
									<div class="roster-info">
										<div class="roster-name-row">
											<span class="roster-name">{agent.name}</span>
											{#if agent.status === 'active'}
												<span class="active-pulse-indicator" title="Online"></span>
											{/if}
										</div>
										<span class="roster-handle">{agent.handle || '@connected'}</span>
									</div>
								</button>
							{/each}
						</div>
					</div>

					<!-- Presets Inside Sidebar -->
					<div class="roster-section presets-section">
						<h4 class="roster-title">Quick presets</h4>
						<div class="presets-grid">
							{#each presets as preset}
								<button
									class="preset-card-btn"
									onclick={() => sendMessage(preset.prompt)}
									disabled={isTyping}
								>
									{preset.label}
								</button>
							{/each}
						</div>
					</div>
				</aside>

				<!-- Main chat column -->
				<div class="chat-viewport-column">
					<!-- Chat Header -->
					<header class="chat-viewport-header">
						<div class="viewport-header-left">
							<div
								class="roster-avatar header-avatar-gradient"
								style="background: {selectedAgent.gradient ||
									'linear-gradient(135deg, #7c6aed, #e84393)'}"
							>
								{selectedAgent.initial || selectedAgent.name.charAt(0)}
							</div>
							<div class="viewport-header-meta">
								<div class="viewport-header-name-row">
									<h3>{selectedAgent.name}</h3>
									{#if selectedAgent.is_overseer || selectedAgent.isHermes}
										<span class="badge-system">Overseer</span>
									{:else}
										<span class="badge-creator">Creator</span>
									{/if}
								</div>
								<span class="viewport-header-handle">{selectedAgent.handle || '@unconnected'}</span>
							</div>
						</div>

						<div class="viewport-header-right">
							<button
								class="clear-history-btn"
								onclick={clearHistory}
								title="Clear conversation history"
							>
								<svg
									width="13"
									height="13"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<polyline points="3 6 5 6 21 6"></polyline>
									<path
										d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
									></path>
								</svg>
								Clear History
							</button>
						</div>
					</header>

					<!-- Messages display area -->
					<div class="messages-scrollbox" bind:this={chatContainer}>
						<div class="messages-interior">
							<!-- Header welcome description block -->
							<div class="welcome-banner-card glass-card">
								<div class="banner-avatar-row">
									<div
										class="banner-avatar"
										style="background: {selectedAgent.gradient ||
											'linear-gradient(135deg, #7c6aed, #e84393)'}"
									>
										{selectedAgent.initial || selectedAgent.name.charAt(0)}
									</div>
									<div
										class="banner-glow-effect"
										style="background: {selectedAgent.gradient ||
											'linear-gradient(135deg, #7c6aed, #e84393)'}"
									></div>
								</div>
								<h2>Interact with {selectedAgent.name}</h2>
								<p class="banner-desc-text">
									Instruct actions, review autonomous logs, or craft custom copy instantly.
								</p>

								<div class="banner-directives-grid">
									<div class="directive-box">
										<h5>Soul Personality Directive</h5>
										<p>{selectedAgent.soul || 'Operational autonomous personality instance.'}</p>
									</div>
									<div class="directive-box">
										<h5>Skills & Competencies</h5>
										<p>
											{selectedAgent.skills ||
												'Autonomous social strategy, campaign scheduling, performance analysis.'}
										</p>
									</div>
								</div>
							</div>

							<!-- Message Bubbles list -->
							{#each messages as msg}
								{#if msg.id !== 'init-msg'}
									<div class="msg-row" class:user-msg-row={msg.sender === 'user'}>
										{#if msg.sender === 'agent'}
											<div class="msg-avatar" style="background: {selectedAgent.gradient}">
												{selectedAgent.initial}
											</div>
										{/if}

										<div class="msg-bubble-pack">
											<!-- Simulated execution logs -->
											{#if msg.logs && msg.logs.length > 0}
												<div class="log-activity-box">
													<div class="log-activity-title">⚙️ Local Tool Executions</div>
													{#each msg.logs as log}
														<div class="log-activity-line">{log}</div>
													{/each}
												</div>
											{/if}

											<div class="msg-bubble glass-card" class:user-bubble={msg.sender === 'user'}>
												<div class="msg-rendered-text">
													{#each msg.text.split('\n') as paragraph}
														{#if paragraph.startsWith('### ')}
															<h4>{paragraph.replace('### ', '')}</h4>
														{:else if paragraph.startsWith('- ')}
															<ul>
																<li>{paragraph.replace('- ', '')}</li>
															</ul>
														{:else}
															<p>
																{@html escapeHtml(paragraph)
																	.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
																	.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>')}
															</p>
														{/if}
													{/each}
												</div>
												<span class="msg-timestamp">{msg.timestamp}</span>
											</div>
										</div>
									</div>
								{/if}
							{/each}

							<!-- Typing/Simulating States -->
							{#if isTyping}
								<div class="msg-row">
									<div class="msg-avatar" style="background: {selectedAgent.gradient}">
										{selectedAgent.initial}
									</div>
									<div class="msg-bubble-pack">
										{#if currentLogs.length > 0}
											<div class="log-activity-box live-log-box">
												<div class="log-activity-title live-row">
													<span>⚙️ Live Agent Activity...</span>
													<span class="live-dot-pulse"></span>
												</div>
												{#each currentLogs as log}
													<div class="log-activity-line fade-in-line">{log}</div>
												{/each}
											</div>
										{/if}

										<div class="typing-container-bubble glass-card">
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
											<span class="typing-dot"></span>
										</div>
									</div>
								</div>
							{/if}
						</div>
					</div>

					<!-- Bottom Text Input bar -->
					<footer class="viewport-footer border-strong">
						<div class="input-panel-wrapper">
							<textarea
								bind:value={inputValue}
								onkeydown={handleKeyDown}
								placeholder="Message {selectedAgent.name}... (Press Enter to dispatch)"
								rows="1"
								disabled={isTyping}
							></textarea>
							<button
								class="dispatch-msg-btn"
								onclick={() => sendMessage(inputValue)}
								disabled={!inputValue.trim() || isTyping}
								aria-label="Send message"
							>
								<svg
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<line x1="22" y1="2" x2="11" y2="13"></line>
									<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
								</svg>
							</button>
						</div>
					</footer>
				</div>
			</div>
		{:else}
			<div class="empty-roster-view glass-card border-strong">
				<p>
					No active agent personas found. Create an agent using the generator tab to initiate
					conversational channels.
				</p>
			</div>
		{/if}
	{/if}

	<!-- TAB 2: ORIGINAL SOCIAL INBOX -->
	{#if activeTab === 'social'}
		<div class="filter-bar">
			<select bind:value={agentFilter}>
				{#each filterAgents as agent (agent.id)}
					<option value={agent.id}>{agent.name}</option>
				{/each}
			</select>
		</div>

		<div class="thread-list">
			{#each filteredThreads as thread (thread.id)}
				<div class="thread-item" class:expanded={expandedId === thread.id}>
					<button class="thread-header" onclick={() => toggleExpand(thread.id)}>
						<span class="platform-icon">{platformIcon(thread.platform)}</span>
						<div
							class="thread-avatar"
							style="background: var(--gradient-subtle, linear-gradient(135deg, var(--surface-3), var(--surface-2)))"
						>
							<span style="color: var(--text); font-weight: 700;">{thread.userAvatar}</span>
						</div>
						<div class="thread-info">
							<div class="thread-meta-row">
								<span class="thread-user">{thread.userName}</span>
								<span class="thread-type">{typeLabel(thread.type)}</span>
								<span class="thread-agent">→ {thread.agentName}</span>
							</div>
							<span class="thread-preview">{thread.messagePreview}</span>
						</div>
						<div class="thread-right">
							<span class="thread-time">{thread.timestamp}</span>
							<span class="thread-status" style="color: {statusColor(thread.status)}">
								<span class="status-dot" style="background: {statusColor(thread.status)}"></span>
								{thread.status}
							</span>
						</div>
						<svg
							class="chevron"
							class:rotated={expandedId === thread.id}
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg
						>
					</button>

					{#if expandedId === thread.id}
						<div class="thread-expanded">
							<div class="message-block">
								<div class="msg-label">
									<span class="msg-from">{thread.userName}</span>
									<span class="msg-badge">{typeLabel(thread.type)}</span>
								</div>
								<p class="msg-body">{thread.fullMessage}</p>
							</div>

							{#if thread.aiReply}
								<div class="message-block ai-block">
									<div class="msg-label">
										<span class="msg-from ai-tag">🤖 AI Suggested Reply</span>
									</div>
									<p class="msg-body">{thread.aiReply}</p>
								</div>
							{/if}

							{#if thread.status === 'pending'}
								<div class="thread-actions">
									<button class="action-btn approve" onclick={() => approveThread(thread.id)}>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"><polyline points="20 6 9 17 4 12" /></svg
										>
										Approve Reply
									</button>
									<button class="action-btn edit">
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
												d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
											/></svg
										>
										Edit Reply
									</button>
									<button class="action-btn ignore" onclick={() => ignoreThread(thread.id)}>
										<svg
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											stroke-width="2"
											><circle cx="12" cy="12" r="10" /><line
												x1="4.93"
												y1="4.93"
												x2="19.07"
												y2="19.07"
											/></svg
										>
										Ignore
									</button>
								</div>
							{:else}
								<div class="thread-status-bar">
									<span class="status-resolved" style="color: {statusColor(thread.status)}">
										{thread.status === 'approved' ? '✓ Reply sent' : '⊘ Ignored'}
									</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<!-- TAB 3: ORIGINAL EMAIL INBOX -->
	{#if activeTab === 'email'}
		<div class="thread-list">
			{#each emails as email (email.id)}
				<div
					class="thread-item email-item"
					class:expanded={expandedId === email.id}
					class:unread={!email.read}
				>
					<button class="thread-header" onclick={() => toggleExpand(email.id)}>
						<div
							class="email-avatar"
							style="background: var(--gradient-subtle, linear-gradient(135deg, var(--surface-3), var(--surface-2)))"
						>
							<span style="color: var(--text); font-weight: 700;">{email.sender[0]}</span>
						</div>
						<div class="thread-info">
							<div class="thread-meta-row">
								<span class="thread-user">{email.sender}</span>
								<span class="thread-agent">→ {email.agentName}</span>
							</div>
							<span class="email-subject">{email.subject}</span>
							<span class="thread-preview">{email.preview}</span>
						</div>
						<div class="thread-right">
							<span class="thread-time">{email.date}</span>
							{#if !email.read}
								<span class="unread-dot"></span>
							{/if}
						</div>
						<svg
							class="chevron"
							class:rotated={expandedId === email.id}
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"><polyline points="6 9 12 15 18 9" /></svg
						>
					</button>

					{#if expandedId === email.id}
						<div class="thread-expanded">
							<div class="email-meta">
								<span class="email-from"
									>From: <strong>{email.sender}</strong> &lt;{email.senderEmail}&gt;</span
								>
								<span class="email-subj">Subject: {email.subject}</span>
							</div>

							<div class="message-block">
								<p class="msg-body email-body">{email.fullBody}</p>
							</div>

							<div class="message-block ai-block">
								<div class="msg-label">
									<span class="msg-from ai-tag">🤖 AI Draft Reply</span>
								</div>
								<p class="msg-body email-body">{email.aiDraft}</p>
							</div>

							<div class="thread-actions">
								<button class="action-btn approve" onclick={() => sendEmailReply(email.id)}>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><line x1="22" y1="2" x2="11" y2="13" /><polygon
											points="22 2 15 22 11 13 2 9 22 2"
										/></svg
									>
									Send Reply
								</button>
								<button class="action-btn edit">
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
											d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
										/></svg
									>
									Edit Draft
								</button>
								<button class="action-btn ignore" onclick={() => archiveEmail(email.id)}>
									<svg
										width="14"
										height="14"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										><polyline points="21 8 21 21 3 21 3 8" /><rect
											x="1"
											y="3"
											width="22"
											height="5"
										/><line x1="10" y1="12" x2="14" y2="12" /></svg
									>
									Archive
								</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	.page {
		padding: 2rem;
		max-width: 1200px;
		margin: 0 auto;
	}

	.page-header {
		margin-bottom: 1.5rem;
	}

	.page-header h1 {
		font-size: var(--text-3xl);
		font-family: var(--font-display);
		margin-bottom: 0.5rem;
		color: var(--text);
	}

	.subtitle {
		color: var(--text-muted);
		font-size: var(--text-base);
	}

	/* ── Tab Bar Navigation ── */
	.inbox-tabs {
		display: flex;
		gap: 0.25rem;
		background: var(--surface-2, #1e293b);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.35rem;
		margin-bottom: 1.25rem;
		width: fit-content;
	}

	.inbox-tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 1.25rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
		transition:
			color 0.2s ease,
			background 0.2s ease;
		font-family: var(--font-body);
	}

	.inbox-tab:hover {
		color: var(--text);
	}

	.inbox-tab.active {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.tab-badge {
		background: var(--accent);
		color: #fff;
		font-size: 10px;
		font-weight: 700;
		padding: 1px 7px;
		border-radius: 10px;
		min-width: 18px;
		text-align: center;
	}

	/* ── Filter ── */
	.filter-bar {
		margin-bottom: 1rem;
	}

	.filter-bar select {
		background: var(--bg);
		border: 1px solid var(--border-strong);
		color: var(--text);
		padding: 0.5rem;
		border-radius: var(--radius-sm);
		max-width: 220px;
		outline: none;
	}

	/* ── Thread List ── */
	.thread-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.thread-item {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
		transition:
			border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	.thread-item:hover {
		border-color: var(--border-hover);
	}

	.thread-item.expanded {
		border-color: var(--accent-mid);
		box-shadow: 0 4px 20px rgba(124, 106, 237, 0.05);
	}

	.thread-item.unread {
		border-left: 3px solid var(--accent);
	}

	.thread-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--text);
		font-family: var(--font-body);
	}

	.platform-icon {
		font-size: 1.25rem;
		flex-shrink: 0;
		width: 28px;
		text-align: center;
	}

	.thread-avatar,
	.email-avatar {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.thread-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.thread-meta-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.thread-user {
		font-weight: 600;
		font-size: var(--text-sm);
	}

	.thread-type {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		background: var(--surface-3);
		padding: 1px 6px;
		border-radius: 4px;
	}

	.thread-agent {
		font-size: var(--text-xs);
		color: var(--accent);
	}

	.thread-preview {
		font-size: var(--text-xs);
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 500px;
	}

	.email-subject {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--text);
	}

	.thread-right {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	.thread-time {
		font-size: 10px;
		color: var(--text-dim);
		white-space: nowrap;
	}

	.thread-status {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}

	.status-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		display: inline-block;
	}

	.unread-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
	}

	.chevron {
		color: var(--text-dim);
		flex-shrink: 0;
		transition: transform 0.2s ease;
	}

	.chevron.rotated {
		transform: rotate(180deg);
	}

	/* Expanded item styling */
	.thread-expanded {
		padding: 0 1.25rem 1.25rem;
		border-top: 1px solid var(--border);
	}

	.email-meta {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.75rem 0;
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.email-meta strong {
		color: var(--text);
	}

	.message-block {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem;
		margin-top: 0.75rem;
	}

	.ai-block {
		border-color: var(--accent-mid);
		background: var(--accent-soft);
	}

	.msg-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.msg-from {
		font-weight: 600;
		font-size: var(--text-sm);
		color: var(--text);
	}

	.ai-tag {
		color: var(--accent);
	}

	.msg-badge {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-dim);
		background: var(--surface-3);
		padding: 1px 6px;
		border-radius: 4px;
	}

	.msg-body {
		font-size: var(--text-sm);
		color: var(--text-muted);
		line-height: 1.7;
	}

	.email-body {
		white-space: pre-wrap;
	}

	.thread-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 1rem;
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.2s ease,
			transform 0.15s ease;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-muted);
		font-family: var(--font-body);
	}

	.action-btn:hover {
		transform: translateY(-1px);
		color: var(--text);
		border-color: var(--border-hover);
	}

	.action-btn.approve {
		background: var(--success-soft);
		border-color: rgba(16, 185, 129, 0.2);
		color: var(--success);
	}

	.action-btn.approve:hover {
		background: rgba(16, 185, 129, 0.15);
	}

	.action-btn.edit:hover {
		border-color: var(--accent-mid);
		color: var(--accent);
	}

	.action-btn.ignore {
		color: var(--text-dim);
	}

	.action-btn.ignore:hover {
		border-color: rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	.thread-status-bar {
		padding: 0.75rem 0 0;
	}

	.status-resolved {
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.04em;
	}

	/* ────────────────────────────────────────────────────────── */
	/* ── integrated chat portal layout (uniform colors theme) ── */
	/* ────────────────────────────────────────────────────────── */
	.chat-portal-container {
		display: flex;
		height: 650px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
	}

	.border-strong {
		border-color: var(--border-strong, rgba(124, 106, 237, 0.15)) !important;
	}

	/* Chat list sidebar */
	.chat-roster-sidebar {
		width: 290px;
		background: var(--surface-2, #1e293b);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1.25rem;
		flex-shrink: 0;
	}

	.roster-section {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
	}

	.list-section {
		flex-grow: 1;
	}

	.section-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.25rem;
	}

	.badge-count {
		font-size: 11px;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 1px 7px;
		border-radius: 12px;
		border: 1px solid rgba(124, 106, 237, 0.15);
	}

	.roster-title {
		margin: 0;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 700;
		color: var(--text-dim);
	}

	/* Roster buttons / cards */
	.roster-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 0.6rem 0.75rem;
		text-align: left;
		cursor: pointer;
		position: relative;
		transition: all 0.2s ease;
		width: 100%;
	}

	.roster-card:hover {
		border-color: var(--border-hover);
		background: var(--surface-3);
	}

	.roster-card.active {
		background: var(--accent-soft);
		border-color: var(--accent-mid);
		box-shadow: 0 2px 10px rgba(124, 106, 237, 0.05);
	}

	.roster-card.overseer-card.active {
		background: var(--success-soft, rgba(16, 185, 129, 0.05));
		border-color: var(--success);
	}

	.roster-avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		color: #ffffff;
		font-size: 12px;
		flex-shrink: 0;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
		box-shadow: var(--shadow-sm);
	}

	.roster-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex-grow: 1;
	}

	.roster-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.roster-name {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--text);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.roster-handle {
		font-size: 10.5px;
		color: var(--text-dim);
		font-family: var(--font-body);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.badge-system {
		font-size: 8.5px;
		font-weight: 700;
		color: var(--success);
		background: var(--success-soft);
		padding: 0px 4px;
		border-radius: 3px;
		border: 1px solid rgba(16, 185, 129, 0.15);
		text-transform: uppercase;
	}

	.badge-creator {
		font-size: 8.5px;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-soft);
		padding: 0px 4px;
		border-radius: 3px;
		border: 1px solid rgba(124, 106, 237, 0.15);
		text-transform: uppercase;
	}

	.active-pulse-indicator {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background-color: var(--success);
		box-shadow: 0 0 5px var(--success);
	}

	.roster-scroll-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		overflow-y: auto;
		flex-grow: 1;
		padding-right: 2px;
	}

	/* Quick presets styles */
	.presets-section {
		flex-shrink: 0;
	}

	.presets-grid {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.preset-card-btn {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		cursor: pointer;
		font-size: 11px;
		font-weight: 500;
		padding: 0.5rem;
		text-align: left;
		transition: all 0.2s ease;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.preset-card-btn:hover:not(:disabled) {
		background: var(--accent-soft);
		border-color: var(--accent-mid);
		color: var(--accent);
		transform: translateX(1px);
	}

	.preset-card-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Right column main chat view */
	.chat-viewport-column {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		position: relative;
		min-width: 0;
	}

	/* Chat Header */
	.chat-viewport-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.85rem 1.5rem;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
		z-index: 5;
	}

	.viewport-header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.viewport-header-meta {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.viewport-header-name-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.viewport-header-name-row h3 {
		margin: 0;
		font-size: 13.5px;
		font-weight: 700;
		color: var(--text);
	}

	.viewport-header-handle {
		font-size: 10.5px;
		color: var(--text-dim);
		font-family: var(--font-body);
	}

	.clear-history-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		color: var(--text-dim);
		font-size: 11px;
		font-weight: 600;
		padding: 0.4rem 0.75rem;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.clear-history-btn:hover {
		border-color: rgba(239, 68, 68, 0.3);
		color: var(--error);
		background: var(--surface-2);
	}

	/* Messages viewport container */
	.messages-scrollbox {
		flex-grow: 1;
		overflow-y: auto;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
	}

	.messages-interior {
		max-width: 750px;
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	/* Welcome Banner Overlay */
	.welcome-banner-card {
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem;
		text-align: center;
		margin-bottom: 1.25rem;
		position: relative;
		overflow: hidden;
	}

	.banner-avatar-row {
		position: relative;
		width: 52px;
		height: 52px;
		margin: 0 auto 1.25rem auto;
	}

	.banner-avatar {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		font-weight: 800;
		color: #ffffff;
		z-index: 2;
		position: relative;
		box-shadow: var(--shadow-md);
	}

	.banner-glow-effect {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		filter: blur(14px);
		opacity: 0.4;
		z-index: 1;
		transform: scale(1.1);
	}

	.welcome-banner-card h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1.35rem;
		font-weight: 800;
		color: var(--text);
	}

	.banner-desc-text {
		font-size: 12px;
		color: var(--text-dim);
		margin: 0 0 1.5rem 0;
	}

	.banner-directives-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1.25rem;
		text-align: left;
	}

	.directive-box {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 1rem;
	}

	.directive-box h5 {
		margin: 0 0 0.4rem 0;
		font-size: 11px;
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.directive-box p {
		margin: 0;
		font-size: 11px;
		color: var(--text-muted);
		line-height: 1.5;
	}

	/* Custom msg row styles */
	.msg-row {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
		max-width: 85%;
	}

	.user-msg-row {
		align-self: flex-end;
		flex-direction: row-reverse;
	}

	.msg-avatar {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 800;
		color: #ffffff;
		font-size: 11px;
		box-shadow: var(--shadow-sm);
		flex-shrink: 0;
	}

	.msg-bubble-pack {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
	}

	.msg-bubble {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		border-top-left-radius: 4px;
		padding: 0.85rem 1.1rem;
		position: relative;
		max-width: 100%;
	}

	.user-bubble {
		background: var(--accent-soft);
		border-color: rgba(124, 106, 237, 0.2);
		border-radius: 14px;
		border-top-right-radius: 4px;
		box-shadow: 0 2px 10px rgba(124, 106, 237, 0.03);
	}

	.msg-rendered-text p {
		margin: 0 0 0.4rem 0;
		font-size: 13px;
		line-height: 1.55;
		color: var(--text);
	}

	.msg-rendered-text p:last-child {
		margin-bottom: 0;
	}

	.msg-rendered-text h4 {
		margin: 0 0 0.5rem 0;
		font-size: 13px;
		font-weight: 700;
		color: var(--accent);
	}

	.msg-rendered-text ul {
		margin: 0 0 0.5rem 0;
		padding-left: 1.1rem;
	}

	.msg-rendered-text li {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
		margin-bottom: 0.2rem;
	}

	.msg-timestamp {
		display: block;
		font-size: 9.5px;
		color: var(--text-dim);
		margin-top: 0.35rem;
		text-align: right;
	}

	/* Activity Logs Box */
	.log-activity-box {
		background: var(--surface-3);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 0.6rem 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-width: 100%;
		font-family: var(--font-body);
	}

	.live-log-box {
		border-color: rgba(124, 106, 237, 0.15);
	}

	.log-activity-title {
		font-size: 10.5px;
		font-weight: 700;
		color: var(--text-dim);
		margin-bottom: 2px;
	}

	.log-activity-line {
		font-size: 10.5px;
		color: var(--accent);
	}

	.fade-in-line {
		animation: fade-in-log 0.25s ease forwards;
	}

	.live-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.live-dot-pulse {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		animation: pulse-active 1.4s infinite ease-in-out;
	}

	@keyframes pulse-active {
		0%,
		100% {
			transform: scale(1);
			opacity: 0.4;
		}
		50% {
			transform: scale(1.25);
			opacity: 1;
		}
	}

	/* Simulated Typing dot bubble */
	.typing-container-bubble {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 14px;
		border-top-left-radius: 4px;
		padding: 0.65rem 1rem;
		display: flex;
		align-items: center;
		gap: 3.5px;
		width: fit-content;
	}

	.typing-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--text-dim);
		animation: bounce-typing-dot 1.4s infinite ease-in-out both;
	}

	.typing-dot:nth-child(1) {
		animation-delay: -0.32s;
	}
	.typing-dot:nth-child(2) {
		animation-delay: -0.16s;
	}

	@keyframes bounce-typing-dot {
		0%,
		80%,
		100% {
			transform: scale(0);
		}
		40% {
			transform: scale(1);
		}
	}

	/* Bottom dispatch panel footer */
	.viewport-footer {
		padding: 1rem 1.5rem;
		background: var(--surface-2);
		border-top: 1px solid var(--border);
	}

	.input-panel-wrapper {
		max-width: 750px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		background: var(--bg);
		border: 1px solid var(--border-strong);
		border-radius: 12px;
		padding: 0.6rem 1rem;
		transition: all 0.25s ease;
	}

	.input-panel-wrapper:focus-within {
		border-color: var(--accent-mid);
		box-shadow: 0 0 15px rgba(124, 106, 237, 0.04);
	}

	textarea {
		flex-grow: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text);
		font-size: 13px;
		line-height: 1.5;
		resize: none;
		font-family: inherit;
		padding: 0.2rem 0;
		max-height: 100px;
	}

	textarea::placeholder {
		color: var(--text-dim);
	}

	.dispatch-msg-btn {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: var(--accent);
		color: #ffffff;
		border: none;
		outline: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s ease;
		flex-shrink: 0;
	}

	.dispatch-msg-btn:hover:not(:disabled) {
		background: var(--accent-mid);
		transform: scale(1.03);
	}

	.dispatch-msg-btn:disabled {
		background: var(--surface-3);
		color: var(--text-dim);
		cursor: not-allowed;
	}

	/* Inline-code style element overrides */
	:global(.inline-code) {
		font-family: var(--font-mono, monospace);
		font-size: 11px;
		background: var(--surface-3);
		padding: 2px 4px;
		border-radius: 4px;
		color: var(--error);
		border: 1px solid var(--border);
	}

	.empty-roster-view {
		padding: 3rem;
		text-align: center;
		color: var(--text-muted);
	}

	@keyframes fade-in-log {
		from {
			opacity: 0;
			transform: translateY(2px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ────────────────────────────────── */
	/* ── Responsive Mobile Adaptive ── */
	/* ────────────────────────────────── */
	@media (max-width: 768px) {
		.page {
			padding: 1rem;
		}

		.inbox-tabs {
			width: 100%;
		}

		.inbox-tab {
			flex: 1;
			justify-content: center;
			font-size: var(--text-xs);
			padding: 0.5rem;
		}

		.chat-portal-container {
			flex-direction: column;
			height: auto;
		}

		.chat-roster-sidebar {
			width: 100%;
			border-right: none;
			border-bottom: 1px solid var(--border);
			height: auto;
			display: grid;
			grid-template-columns: 1fr 1.25fr;
			gap: 0.75rem;
			padding: 0.75rem;
		}

		.chat-roster-sidebar > .roster-section:first-child {
			grid-column: 1;
		}

		.chat-roster-sidebar > .list-section {
			grid-column: 2;
			min-width: 0;
		}

		.chat-roster-sidebar > .presets-section {
			grid-column: span 2;
		}

		.roster-scroll-list {
			flex-direction: row;
			overflow-x: auto;
			overflow-y: hidden;
			white-space: nowrap;
			gap: 0.5rem;
			padding-bottom: 4px;
			display: flex;
		}

		.roster-scroll-list .roster-card {
			width: 160px;
			flex-shrink: 0;
		}

		.presets-grid {
			flex-direction: row;
			overflow-x: auto;
			overflow-y: hidden;
			gap: 0.5rem;
			padding-bottom: 4px;
		}

		.preset-card-btn {
			width: auto;
			flex-shrink: 0;
			padding: 0.4rem 0.75rem;
		}

		.roster-title {
			font-size: 10px;
			margin-bottom: 0.25rem;
		}

		.chat-viewport-column {
			height: 480px;
		}

		.messages-scrollbox {
			padding: 1rem;
		}

		.welcome-banner-card {
			padding: 1.25rem;
		}

		.banner-directives-grid {
			grid-template-columns: 1fr;
		}

		.chat-viewport-header {
			padding: 0.75rem 1rem;
		}

		.clear-history-btn {
			padding: 0.35rem 0.5rem;
			font-size: 10px;
		}

		.viewport-footer {
			padding: 0.75rem 1rem;
		}

		.input-panel-wrapper {
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
		}

		.msg-row {
			max-width: 95%;
			gap: 0.5rem;
		}

		.thread-header {
			flex-wrap: wrap;
			padding: 0.75rem;
		}

		.thread-right {
			width: 100%;
			flex-direction: row;
			justify-content: space-between;
			margin-top: 0.5rem;
		}

		.thread-preview {
			max-width: 100%;
		}

		.thread-actions {
			flex-direction: column;
		}

		.action-btn {
			justify-content: center;
		}
	}
</style>
