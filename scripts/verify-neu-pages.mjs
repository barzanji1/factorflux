// Browser smoke checks use the normal login form and existing development-only
// test credentials. No credential, session cookie or client contents are logged.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const out = process.env.NEU_SMOKE_OUTPUT || "generated-artifacts/neu-rollout";
// Keep the development hostname/Host header, while selecting the workflow's
// known application port rather than an unrelated port on Preview's proxy.
const host = process.env.REPLIT_DEV_DOMAIN;
const base = process.env.NEU_SMOKE_BASE_URL || `http://${host}:5000`;
let routes = process.env.NEU_SMOKE_ROUTES?.split(",").filter(Boolean) || ["/client-email", "/client-email?tab=log", "/email-log", "/factoring", "/sheets", "/payouts",
  "/cash-application", "/lockbox", "/fuel-advance", "/bank-transfers", "/dispatchers", "/trucks", "/release-letters",
  "/credit-checks", "/fmcsa-authority", "/held", "/audit-log", "/followups", "/reports", "/admin", "/payroll",
  "/expenses", "/vault", "/document-rules", "/workflow-builder"];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(path.join(tmpdir(), "neu-browser-"));
let browser, socket;
try {
  if (!process.env.DEV_ADMIN_EMAIL || !process.env.DEV_ADMIN_PASSWORD) throw new Error("Development test credentials unavailable");
  await mkdir(out, { recursive: true });
  // Pipe transport opens no extra port that could confuse Preview routing.
  browser = spawn("/repl/tools/bin/chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--remote-debugging-pipe",
    `--host-resolver-rules=MAP ${host} 127.0.0.1`, "--no-proxy-server",
    `--unsafely-treat-insecure-origin-as-secure=${base}`,
    `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  socket = { send: data => browser.stdio[3].write(`${data}\0`), close: () => browser.stdio[3].end() };
  let id = 0, session, uncaught = 0, exceptions = [];
  const pending = new Map();
  const handleMessage = message => {
    if (message.method === "Runtime.exceptionThrown") {
      uncaught++;
      exceptions.push((message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED]").slice(0,1000));
    }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error ? request.reject(new Error("Browser protocol command failed")) : request.resolve(message.result);
    }
  };
  let buffered = "";
  const decoder = new StringDecoder("utf8");
  browser.stdio[4].on("data", chunk => {
    buffered += decoder.write(chunk);
    let boundary;
    while ((boundary = buffered.indexOf("\0")) !== -1) {
      const encoded = buffered.slice(0,boundary);
      buffered = buffered.slice(boundary+1);
      if (encoded) handleMessage(JSON.parse(encoded));
    }
  });
  const send = (method, params = {}, scoped = true) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(new Error(`Browser command timed out: ${method}`)); }, 20_000);
    pending.set(key, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params, ...(scoped && session ? { sessionId: session } : {}) }));
  });
  const target = await send("Target.createTarget", { url: "about:blank" }, false);
  session = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, false)).sessionId;
  await send("Page.enable"); await send("Runtime.enable");
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Browser evaluation failed");
    return result.result.value;
  };
  const navigate = async route => {
    await send("Page.navigate", { url: `${base}${route}` });
    await delay(1600);
  };
  const pointerClick = async selector => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center',behavior:'instant'})`);
    await delay(150);
    const rect = await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:el.contains(document.elementFromPoint(x,y))};})()`);
    if (!rect) throw new Error("Expected form control missing");
    if (!rect.hit) throw new Error(`Pointer target blocked: ${selector}`);
    const {x,y} = rect;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x,y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x,y, button: "left", clickCount: 1 });
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate("/login");
  if (process.env.PRODUCTION_PERFORMANCE_VERIFY === "1") {
    const startup = await evaluate(`performance.getEntriesByType('resource')
      .filter(entry => new URL(entry.name).pathname.endsWith('.js'))
      .map(entry => ({ file: new URL(entry.name).pathname, bytes: entry.decodedBodySize, compressedBytes: entry.encodedBodySize }))`);
    const operational = startup.filter(entry => /\/(?:dashboard|invoices|carriers|brokers|reports|EmojiPicker|BarChart)-/.test(entry.file));
    if (operational.length) throw new Error("Login loaded operational page or chart/emoji bundles");
    await writeFile(`${out}/login-startup.json`, JSON.stringify(startup, null, 2));
    console.log(JSON.stringify({ loginJavaScriptFiles: startup.length, noOperationalBundlesOnLogin: true }));
  }
  for (let i = 0; i < 150 && !await evaluate("!!document.querySelector('input[type=email]')"); i++) await delay(200);
  if (!await evaluate("!!document.querySelector('input[type=email]')")) {
    const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
    await writeFile(`${out}/login-debug.jpg`, Buffer.from(image.data, "base64"));
    throw new Error(`Login form did not render; page path: ${await evaluate("location.pathname")}; screenshot saved`);
  }
  if (await evaluate("!!document.querySelector('vite-error-overlay')")) throw new Error("Development error overlay is blocking login");
  await pointerClick("input[type=email]");
  await send("Input.insertText", { text: process.env.DEV_ADMIN_EMAIL });
  await pointerClick("input[type=password]");
  await send("Input.insertText", { text: process.env.DEV_ADMIN_PASSWORD });
  if (process.env.LAYOUT_VERIFY === "1") {
    await evaluate(`(() => {
      window.__layoutFrames = [];
      window.__layoutSnapshot = () => {
        const shell = document.querySelector('.ff-financial-dashboard-shell');
        const r = shell?.getBoundingClientRect();
        const rect = el => {
          if (!el) return null;
          const b = el.getBoundingClientRect(), s = getComputedStyle(el);
          return {className:el.className, top:b.top, bottom:b.bottom, height:b.height,
            scrollHeight:el.scrollHeight, heightStyle:s.height,minHeight:s.minHeight,display:s.display};
        };
        return {path:location.pathname, viewport:innerHeight, documentHeight:document.documentElement.scrollHeight,
          scrollY, shell:rect(shell), route:rect(shell?.children[0]),
          app:rect(document.querySelector('.ff-neu-app-shell')), main:rect(document.querySelector('.ff-neu-app-shell main')),
          bad:!!shell && (document.documentElement.scrollHeight > innerHeight + 2 || Math.abs(r.top) > 2 || Math.abs(r.bottom - innerHeight) > 2)};
      };
      let end = 0, watching = false;
      const frame = () => {
        const sample = window.__layoutSnapshot();
        if (sample.bad && window.__layoutFrames.length < 8) window.__layoutFrames.push(sample);
        if (performance.now() < end) requestAnimationFrame(frame);
        else watching = false;
      };
      window.__watchLayout = (duration = 4000) => {
        end = performance.now() + duration;
        if (!watching) {watching = true; requestAnimationFrame(frame);}
      };
      window.__watchLayout(6000);
    })()`);
  }
  await pointerClick("button[type=submit]");
  for (let i = 0; i < 30 && await evaluate("location.pathname") === "/login"; i++) await delay(250);
  if (await evaluate("location.pathname") === "/login") throw new Error("Existing development test credentials did not authenticate; no account changes made");
  const results = [];
  const allNavigationCheck = process.env.ALL_NAVIGATION_VERIFY === "1";
  let menuItems = [];
  if (allNavigationCheck) {
    const isolation = await evaluate(`(() => {
      const root = document.querySelector('.ff-institutional-root');
      const fixture = document.createElement('div');
      fixture.style.cssText = 'position:fixed;left:-9999px;top:0';
      fixture.innerHTML = '<div class="animate-pulse h-12 bg-[#d2d2d2]"></div><div data-ff-status-pulse class="animate-pulse" style="background:orange">Overdue</div>';
      root.append(fixture);
      const outside = fixture.firstChild.cloneNode();
      document.body.append(outside);
      const loading = getComputedStyle(fixture.firstChild);
      const status = getComputedStyle(fixture.lastChild);
      const publicStyle = getComputedStyle(outside);
      const result = {
        quietLoading: loading.animationName === 'none' && loading.backgroundColor === 'rgba(0, 0, 0, 0)',
        statusPreserved: status.animationName !== 'none' && status.backgroundColor === 'rgb(255, 165, 0)',
        publicUntouched: publicStyle.animationName !== 'none' && publicStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
      };
      fixture.remove(); outside.remove();
      return result;
    })()`);
    if (!Object.values(isolation).every(Boolean)) throw new Error(`Loading isolation regression: ${JSON.stringify(isolation)}`);
    console.log(JSON.stringify({ loadingIsolation: isolation }));
    const source = await readFile("client/src/components/layout/sidebar.tsx", "utf8");
    const renderedLabels = await evaluate("Array.from(document.querySelectorAll('aside button[aria-label]'), el => el.getAttribute('aria-label'))");
    menuItems = [...source.matchAll(/\{\s*name:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)]
      .map(([, label, route]) => ({ label, route }))
      .filter(item => renderedLabels.includes(item.label));
    if (menuItems.length < 25) throw new Error("Expected the complete development-admin sidebar");
    routes = menuItems.map(item => item.route);
    if (process.env.NEU_SMOKE_ROUTES) routes = routes.filter(route => process.env.NEU_SMOKE_ROUTES.split(",").includes(route));
    // Slow all actual reads so each page's own loading branch can be inspected.
    await evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        if (url.pathname.startsWith('/api/') && (!init?.method || init.method === 'GET')) {
          await new Promise(resolve => setTimeout(resolve, ${process.env.PRODUCTION_PERFORMANCE_VERIFY === "1" ? 0 : 1200}));
        }
        return original(input, init);
      };
      window.__navigationTimeOrigin = performance.timeOrigin;
    })()`);
  }
  const navigationCheck = process.env.NAVIGATION_VERIFY === "1";
  if (navigationCheck) {
    // Slow real read requests in this browser only so transient UI stays visible.
    // No fixture data, auth bypass, or changes to server behavior.
    await evaluate(`(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        if ((!init?.method || init.method === 'GET') &&
            (url.pathname.endsWith('/stats') || url.pathname === '/api/calendar/events')) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        return original(input, init);
      };
      window.__navigationTimeOrigin = performance.timeOrigin;
    })()`);
  }
  for (const requestedRoute of routes) {
    let route = requestedRoute;
    if (process.env.LAYOUT_VERIFY === "1") await evaluate("window.__watchLayout()");
    if (requestedRoute.endsWith("/:first")) {
      const entity = requestedRoute.split("/")[1];
      const firstId = await evaluate(`(async()=>{const response=await fetch('/api/${entity}?limit=15',{credentials:'include'});if(!response.ok)return null;const payload=await response.json();const rows=Array.isArray(payload)?payload:payload.data??payload.items??payload.${entity}??[];return Array.isArray(rows)&&rows[0]?.id!=null?String(rows[0].id):null;})()`);
      if (!firstId) {
        results.push({ route: requestedRoute, skipped: true, reason: "No accessible existing record for detail smoke check" });
        console.log(JSON.stringify({ route: requestedRoute, skipped: true }));
        continue;
      }
      route = `/${entity}/${encodeURIComponent(firstId)}`;
    }
    uncaught = 0; exceptions = [];
    if (allNavigationCheck) {
      const item = menuItems.find(item => item.route === route);
      await pointerClick(`aside button[aria-label="${item.label}"]`);
      await delay(150);
      const loading = await evaluate(`(() => {
        const root = document.querySelector('.ff-institutional-root');
        const placeholders = root?.querySelectorAll('.animate-pulse:not([data-ff-status-pulse]):empty, .animate-pulse:not([data-ff-status-pulse]) :empty, .ff-neu-metric-skeleton span, .ff-neu-chart-skeleton span, .ff-activity-skeleton :is(i,span), .ff-action-skeleton-icon, .ff-action-skeleton-line, .ff-action-skeleton-value') ?? [];
        const visible = [...placeholders].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const opaque = visible.filter(el => {
          const c = getComputedStyle(el).backgroundColor;
          // White material cards are the current design, not gray skeleton slabs.
          return c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(255, 255, 255)';
        });
        return { path: location.pathname + location.search, placeholders: visible.length,
          grayBlocks: opaque.length,
          opaqueStyles: opaque.map(el => ({className: typeof el.className === 'string' ? el.className : el.tagName, color:getComputedStyle(el).backgroundColor})),
          sameDocument: performance.timeOrigin === window.__navigationTimeOrigin };
      })()`);
      if (!loading.sameDocument || loading.grayBlocks) {
        throw new Error(`Loading presentation regression: ${JSON.stringify(loading)}`);
      }
      const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
      await writeFile(`${out}/${item.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-loading.jpg`, Buffer.from(image.data, "base64"));
      await delay(1800);
      console.log(JSON.stringify({ sidebar: item.label, route, ...loading }));
    } else if (navigationCheck) {
      const labels = { "/calendar": "Calendar", "/invoices": "Invoices", "/tasks": "Tasks" };
      if (!labels[route]) throw new Error("Navigation verification requires a supported sidebar route");
      await pointerClick(`aside button[aria-label="${labels[route]}"]`);
      for (let i = 0; i < 40; i++) {
        if (await evaluate("Boolean(document.querySelector('[data-insights-entity]'))")) break;
        await delay(50);
      }
      await delay(50);
      const pendingState = await evaluate(`(() => {
        const insights = document.querySelector('[data-insights-entity]');
        const calendar = document.querySelector('[aria-label="Calendar events"]');
        return {
          path: location.pathname,
          sameDocument: performance.timeOrigin === window.__navigationTimeOrigin,
          busy: insights?.getAttribute('aria-busy') === 'true',
          stats: insights?.querySelectorAll('.insight-stat').length,
          grayBlocks: insights?.querySelectorAll('.animate-pulse').length,
          calendarBusy: calendar?.getAttribute('aria-busy') === 'true',
          calendarTop: calendar?.getBoundingClientRect().top,
          calendarDates: calendar?.querySelectorAll('button[aria-label^="Add event on"]').length
        };
      })()`);
      if (pendingState.path !== route || !pendingState.sameDocument || !pendingState.busy ||
          pendingState.stats !== 3 || pendingState.grayBlocks !== 0) {
        const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
        await writeFile(`${out}/${route.slice(1)}-failure.jpg`, Buffer.from(image.data, "base64"));
        throw new Error(`Sidebar loading-state regression on ${route}: ${JSON.stringify(pendingState)}`);
      }
      if (route === "/calendar" && (!pendingState.calendarBusy || pendingState.calendarDates < 28)) {
        throw new Error("Calendar grid disappeared while events were loading");
      }
      const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65 });
      await writeFile(`${out}/${route.slice(1)}-loading.jpg`, Buffer.from(image.data, "base64"));
      await delay(2100);
      if (route === "/calendar") {
        const finalTop = await evaluate("document.querySelector('[aria-label=\"Calendar events\"]').getBoundingClientRect().top");
        if (Math.abs(finalTop - pendingState.calendarTop) > 4) {
          throw new Error(`Calendar shifted ${Math.round(finalTop - pendingState.calendarTop)}px after insights loaded`);
        }
      }
      console.log(JSON.stringify({ sidebarNavigation: route, pendingLayoutStable: true, grayBlocks: 0 }));
    } else {
      await evaluate(`(()=>{history.pushState({},'',${JSON.stringify(route)});dispatchEvent(new PopStateEvent('popstate'));})()`);
    }
    for (let i = 0; i < 60; i++) {
      if (await evaluate("!!document.querySelector('[data-insights-entity], aside, [data-sidebar=\"sidebar\"]')")) break;
      await delay(150);
    }
    await delay(800);
    const status = await evaluate(`({
      path:location.pathname,
      sidebar:!!document.querySelector('aside, [data-sidebar="sidebar"]'),
      notFound:/404 Page Not Found|page doesn't exist/i.test(document.body.innerText),
      accessDenied:/Access Denied|don't have permission to access/i.test(document.body.innerText),
      overlays:!!document.querySelector('vite-error-overlay'),
      insights:document.querySelectorAll('[data-insights-entity]').length,
      horizontalOverflow:document.documentElement.scrollWidth > innerWidth + 2
    })`);
    const ok = !status.notFound && !status.accessDenied && !status.overlays && uncaught === 0 && status.path !== "/login" && status.sidebar;
    if (process.env.LAYOUT_VERIFY === "1") {
      const beforeScroll = await evaluate(`(() => {
        const el = [...document.querySelectorAll('main')].find(el => {
          const s=getComputedStyle(el),r=el.getBoundingClientRect();
          return r.height>0 && /auto|scroll/.test(s.overflowY);
        });
        return el ? {top:el.scrollTop, excess:el.scrollHeight-el.clientHeight} : null;
      })()`);
      await send("Input.dispatchMouseEvent", { type:"mouseWheel", x:900, y:800, deltaX:0, deltaY:1800 });
      await delay(300);
      if (beforeScroll?.excess > 50 && beforeScroll.top === 0) {
        const scrolled = await evaluate("[...document.querySelectorAll('main, main *')].some(el => el.scrollTop > 0)");
        if (!scrolled) throw new Error("Content scrolling stopped working after layout containment");
      }
      const layout = await evaluate("window.__layoutSnapshot()");
      const frames = await evaluate("window.__layoutFrames");
      console.log(JSON.stringify({layout, transitionFailures:frames}));
      const image = await send("Page.captureScreenshot", { format:"jpeg", quality:75 });
      await writeFile(`${out}/${route.slice(1) || 'dashboard'}-layout.jpg`, Buffer.from(image.data,"base64"));
      if (layout.bad || frames.length) {
        const overflow = await evaluate(`Array.from(document.body.querySelectorAll('*')).filter(el => {
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return r.bottom > innerHeight + 2 && s.display !== 'none' &&
            (s.position === 'fixed' || s.position === 'absolute' || !document.querySelector('.ff-financial-dashboard-shell')?.contains(el));
        }).slice(0,20).map(el => {
          const r=el.getBoundingClientRect(),s=getComputedStyle(el);
          return {tag:el.tagName,className:typeof el.className==='string'?el.className:'svg',
            position:s.position,top:r.top,bottom:r.bottom,height:r.height,visibility:s.visibility};
        })`);
        console.log(JSON.stringify({overflow}));
        throw new Error("Viewport layout overflow detected");
      }
    }
    results.push({ route, ...status, uncaught, exceptions, ok });
    if (allNavigationCheck || process.env.NEU_SMOKE_ROUTES || ["/client-email?tab=log", "/sheets", "/admin", "/reports"].includes(route)) {
      const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65, captureBeyondViewport: false });
      await writeFile(`${out}/${route.split("?")[0].slice(1).replaceAll("/", "-") || "dashboard"}.jpg`, Buffer.from(image.data, "base64"));
    }
    console.log(JSON.stringify({ route, ok, uncaught, sidebar: status.sidebar, insights: status.insights }));
  }
  if (process.env.DASHBOARD_HEADER_VERIFY === "1") {
    await evaluate(`(()=>{history.pushState({},'','/');dispatchEvent(new PopStateEvent('popstate'));})()`);
    for (let i=0;i<80;i++) {
      if(await evaluate(`!!document.querySelector('.ff-neu-dashboard-summary')&&!document.querySelector('[data-testid="dashboard-refresh"]')?.disabled`))break;
      await delay(150);
    }
    const header=await evaluate(`(async()=>{
      const [personResponse,financialResponse]=await Promise.all([fetch('/api/auth/user'),fetch('/api/agent-dashboard/financial')]);
      if(!personResponse.ok||!financialResponse.ok)throw new Error('Header verification data request failed');
      const person=await personResponse.json(),financial=await financialResponse.json();
      const agentName=[person.firstName,person.lastName].filter(Boolean).join(' ').trim()||person.name||'Agent';
      const money=new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',maximumFractionDigits:2}).format(financial.kpis.fundedThisWeek);
      const expected=agentName+' — '+financial.kpis.openFollowups.toLocaleString()+' open follow-ups · '+money+' funded this week';
      const button=document.querySelector('[data-testid="dashboard-refresh"]'),box=button.getBoundingClientRect();
      return {summaryMatches:document.querySelector('.ff-neu-dashboard-summary')?.textContent.trim()===expected,
        inTopbar:document.querySelector('.ff-neu-top-nav')?.contains(button),
        besideNew:button.previousElementSibling?.textContent.includes('New'),
        iconOnly:button.textContent.trim()===''&&button.getAttribute('aria-label')==='Refresh dashboard',
        circular:Math.abs(box.width-box.height)<1&&parseFloat(getComputedStyle(button).borderRadius)>=box.height/2,
        oldToolbarAbsent:!document.querySelector('.ff-neu-dashboard-toolbar,.ff-neu-updated'),
        oldHeroAbsent:!document.body.innerText.includes('Good work moves forward.')&&!document.body.innerText.includes('A clear view of what is ready, waiting, and getting older.'),
        labelsAbsent:!document.querySelector('.ff-action-heading,.ff-action-hint'),
        cards:document.querySelectorAll('[data-testid="action-grid"] .ff-action-card').length};
    })()`);
    for(const key of ['summaryMatches','inTopbar','besideNew','iconOnly','circular','oldToolbarAbsent','oldHeroAbsent','labelsAbsent']) {
      if(!header[key])throw new Error('Dashboard header verification failed: '+key);
    }
    await evaluate(`(()=>{
      window.__headerRefreshCounts={};
      const original=window.fetch;
      window.fetch=function(...args){const url=typeof args[0]==='string'?args[0]:args[0].url;
        for(const section of ['followups','activity','alerts','financial'])if(url?.startsWith('/api/agent-dashboard/'+section))window.__headerRefreshCounts[section]=(window.__headerRefreshCounts[section]||0)+1;
        return original.apply(this,args);};
    })()`);
    await pointerClick('[data-testid="dashboard-refresh"]');
    let refreshed=false;
    for(let i=0;i<100;i++) {
      refreshed=await evaluate(`['followups','activity','alerts','financial'].every(key=>window.__headerRefreshCounts[key]>0)&&!document.querySelector('[data-testid="dashboard-refresh"]').disabled`);
      if(refreshed)break;
      await delay(150);
    }
    if(!refreshed)throw new Error('Topbar refresh did not reload all four dashboard sections');
    console.log(JSON.stringify({dashboardHeader:{...header,allFourSectionsRefreshed:refreshed}}));
    await writeFile(`${out}/dashboard-header-results.json`,JSON.stringify({...header,allFourSectionsRefreshed:refreshed},null,2));
  }
  if (process.env.TIME_CLOCK_VERIFY === "1") {
    const liveStatus = await evaluate(`(async()=>{const r=await fetch('/api/time-tracking/status',{credentials:'include'});const body=await r.json();return {httpStatus:r.status,shapeValid:typeof body.isClocked==='boolean'&&Array.isArray(body.todayEntries)&&typeof body.todayHours==='number'};})()`);
    if (liveStatus.httpStatus !== 200 || !liveStatus.shapeValid) throw new Error("Authenticated time-clock status endpoint failed");
    // Exercise UI states with browser-local responses, never alter real payroll.
    await evaluate(`(() => {
      window.__clockVerify={fail:true,clocked:false,inCount:0,outCount:0,notes:[]};
      const original=window.fetch.bind(window);
      window.fetch=async(input,init)=>{
        const url=new URL(typeof input==='string'?input:input.url,location.origin);
        const state=window.__clockVerify;
        const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
        if(url.pathname==='/api/time-tracking/status'){
          if(state.fail)return json({message:'Browser-only status error'},503);
          const todayEntries=Array.from({length:4},(_,i)=>({id:990010+i,clockInTime:new Date(Date.now()-(i+1)*3600000).toISOString(),clockOutTime:new Date(Date.now()-(i+1)*3600000+1800000).toISOString(),totalHours:"0.50",status:"clocked_out"}));
          return json({isClocked:state.clocked,currentEntry:state.clocked?{id:990001,clockInTime:new Date(Date.now()-154*60000).toISOString(),status:'clocked_in'}:undefined,todayEntries,todayHours:4.25});
        }
        if(url.pathname==='/api/time-tracking/clock-in'||url.pathname==='/api/time-tracking/clock-out'){
          state.notes.push(JSON.parse(init.body).notes);
          state.clocked=url.pathname.endsWith('clock-in');
          if(state.clocked)state.inCount++;else state.outCount++;
          return json({id:990001,status:state.clocked?'clocked_in':'clocked_out'});
        }
        return original(input,init);
      };
      history.pushState({},'','/');dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    await evaluate(`(async()=>{const {queryClient}=await import('/src/lib/queryClient.ts');await queryClient.invalidateQueries({queryKey:['/api/time-tracking/status']});})()`);
    const waitText = async text => {
      for(let i=0;i<70;i++){
        if(await evaluate(`document.querySelector('[data-testid="time-clock-popover"]')?.innerText.includes(${JSON.stringify(text)})`))return;
        await delay(150);
      }
      throw new Error(`Time clock did not display ${text}`);
    };
    await pointerClick('[data-testid="time-clock-trigger"]');
    await waitText("Time clock unavailable");
    const failureSafe=await evaluate(`![...document.querySelectorAll('[data-testid="time-clock-popover"] button')].some(el=>el.textContent.trim()==='Clock In'&&!el.disabled)`);
    if(!failureSafe)throw new Error("Failed clock status falsely enabled Clock In");
    await evaluate(`window.__clockVerify.fail=false`);
    await pointerClick('[data-testid="time-clock-action"]');
    await waitText("Clock In");
    const inspectClock=()=>evaluate(`(()=>{
      const trigger=document.querySelector('[data-testid="time-clock-trigger"]'),t=trigger.getBoundingClientRect();
      const popup=document.querySelector('[data-testid="time-clock-popover"]'),r=popup.getBoundingClientRect();
      const topbar=trigger.closest('header,.ff-neu-top-nav')||trigger.parentElement;
      const bell=trigger.previousElementSibling,user=trigger.nextElementSibling;
      return {oneTrigger:document.querySelectorAll('[data-testid="time-clock-trigger"]').length===1,
        inTopbar:!!topbar,betweenBellAndUser:!!bell?.querySelector('svg')&&!!user,
        noStrip:!document.querySelector('[data-testid="time-clock-widget"],[data-testid="time-clock-strip"]'),
        anchored:r.top>=t.bottom-1,visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,
        width:r.width,height:r.height,
        recentEntries:document.querySelectorAll('[data-testid="time-clock-recent-entry"]').length,
        total:document.querySelector('[data-testid="time-clock-total"]').textContent,
        status:document.querySelector('[data-testid="time-clock-status"]').textContent,
        liveClock:!!document.querySelector('[data-testid="time-clock-live"]').textContent};
    })()`);
    const desktop=await inspectClock();
    if(!desktop.oneTrigger||!desktop.inTopbar||!desktop.betweenBellAndUser||!desktop.noStrip||!desktop.anchored||!desktop.visible||desktop.recentEntries!==3||!desktop.total.includes('4.25')||!desktop.liveClock)throw new Error("Topbar clock layout or recent-entry details failed");
    await pointerClick('[data-testid="time-clock-notes-input"]');
    await send("Input.insertText",{text:"Browser-only time clock verification"});
    await pointerClick('[data-testid="time-clock-action"]');
    await waitText("Clock Out");
    for(let i=0;i<40;i++){if(await evaluate(`document.querySelector('[data-testid="time-clock-trigger"]').textContent.includes('2h 34m')`))break;await delay(150);}
    const active=await evaluate(`(()=>{const e=document.querySelector('[data-testid="time-clock-trigger"]');return {timer:e.textContent.trim(),clocked:e.getAttribute('data-clocked-in'),animation:getComputedStyle(e,'::after').animationName,status:document.querySelector('[data-testid="time-clock-status"]').textContent};})()`);
    if(!active.timer.includes('2h 34m')||active.clocked!=='true'||active.animation==='none'||!active.status.includes('since'))throw new Error("Active trigger timer, glow or since-status is missing");
    await pointerClick('[data-testid="agent-dashboard"] .ff-neu-eyebrow');
    await delay(200);
    if(await evaluate(`!!document.querySelector('[data-testid="time-clock-popover"]')`))throw new Error("Outside click did not close clock dropdown");
    // Client-side navigation must retain the shared clock on another page.
    await evaluate(`history.pushState({},'','/invoices');dispatchEvent(new PopStateEvent('popstate'))`);
    await delay(700);
    if(!await evaluate(`document.querySelector('[data-testid="time-clock-trigger"]')?.textContent.includes('2h 34m')`))throw new Error("Active clock did not survive page navigation");
    await pointerClick('[data-testid="time-clock-trigger"]');
    await waitText("Clock Out");
    await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await delay(200);
    if(!await evaluate(`!document.querySelector('[data-testid="time-clock-popover"]')&&document.activeElement===document.querySelector('[data-testid="time-clock-trigger"]')`))throw new Error("Escape dismissal/focus restoration failed");
    await pointerClick('[data-testid="time-clock-trigger"]');
    await pointerClick('[data-testid="time-clock-action"]');
    await waitText("Clock In");
    const calls=await evaluate(`({inCount:window.__clockVerify.inCount,outCount:window.__clockVerify.outCount,notes:window.__clockVerify.notes})`);
    if(calls.inCount!==1||calls.outCount!==1||calls.notes[0]!=="Browser-only time clock verification")throw new Error("Time-clock action or notes wiring failed");
    await evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
    const image=await send("Page.captureScreenshot",{format:"jpeg",quality:70});
    await writeFile(`${out}/time-clock-desktop.jpg`,Buffer.from(image.data,"base64"));
    await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await delay(200);
    await evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
    const mobileClock=await inspectClock();
    if(!mobileClock.visible||!mobileClock.anchored||!mobileClock.oneTrigger||!mobileClock.noStrip)throw new Error("Mobile clock dropdown is clipped or missing");
    const mobileImage=await send("Page.captureScreenshot",{format:"jpeg",quality:70});
    await writeFile(`${out}/time-clock-mobile.jpg`,Buffer.from(mobileImage.data,"base64"));
    const clockResult={liveStatus,failureSafe,desktop,mobile:mobileClock,active,calls,outsideClose:true,escapeClose:true,crossPage:true};
    console.log(JSON.stringify({timeClock:clockResult}));
    await writeFile(`${out}/time-clock-results.json`,JSON.stringify(clockResult,null,2));
    await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  }
  let invoiceCreate;
  if (process.env.INVOICE_CREATE_VERIFY === "1") {
    // Browser-local fixtures only. Never create an invoice or upload to storage.
    await evaluate(`(() => {
      window.__invoiceVerify = { submits: 0, debug: [], alerts: [{code:'CARRIER_OPEN_CHARGEBACK',severity:'ack',title:'Carrier has open chargeback',message:'Browser-only regression fixture.'}] };
      const log = console.log;
      console.log = (...args) => { if(args[0] === '[invoice-submit-debug]') window.__invoiceVerify.debug.push(args[1]); log(...args); };
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
        let payload;
        if (url.pathname === '/api/clients') payload = [{id:940001,name:'UI Regression Carrier',status:'active',cargoType:'otr'}];
        else if (url.pathname === '/api/clients/940001') payload = {id:940001,name:'UI Regression Carrier',status:'active'};
        else if (url.pathname === '/api/brokers') payload = {data:[{id:940002,name:'UI Regression Broker',status:'active'}]};
        else if (url.pathname === '/api/brokers/940002') payload = {id:940002,name:'UI Regression Broker',status:'active'};
        else if (url.pathname === '/api/brokers/940002/branches' || url.pathname === '/api/carriers/940001/bank-accounts') payload = [];
        else if (url.pathname === '/api/invoices/preflight') payload = {alerts:window.__invoiceVerify.alerts};
        else if (url.pathname === '/api/invoices/with-documents') {
          window.__invoiceVerify.submits++;
          const data = init.body;
          window.__invoiceVerify.submitted = {metadata:JSON.parse(data.get('metadata')),rateConfirmation:!!data.get('rateConfirmation'),billOfLading:!!data.get('billOfLading')};
          return new Response(JSON.stringify({message:'Browser-only submit intercepted; nothing saved.'}),{status:422,headers:{'Content-Type':'application/json'}});
        } else return original(input, init);
        return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
      };
      history.pushState({},'', '/invoices?create=1'); dispatchEvent(new PopStateEvent('popstate'));
    })()`);
    await delay(1200);
    const clickText = async (text) => {
      const selector = await evaluate(`(() => { const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)return null;el.setAttribute('data-invoice-test-click','true');return '[data-invoice-test-click="true"]';})()`);
      if (!selector) {
        const shot = await send("Page.captureScreenshot", {format:"jpeg",quality:65});
        await writeFile(`${out}/invoice-control-debug.jpg`,Buffer.from(shot.data,"base64"));
        throw new Error(`Missing invoice test control: ${text}`);
      }
      await pointerClick(selector);
      await evaluate(`document.querySelector('[data-invoice-test-click]')?.removeAttribute('data-invoice-test-click')`);
      await delay(180);
    };
    await pointerClick('input[placeholder="Search carriers..."]');
    await delay(100);
    await clickText("UI Regression Carrieractive");
    await delay(250);
    if (await evaluate(`!!document.querySelector('[aria-label="Close preflight alerts"]')`)) await pointerClick('[aria-label="Close preflight alerts"]');
    await delay(350);
    await pointerClick('input[placeholder="Search brokers..."]');
    await delay(350);
    await clickText("UI Regression Brokeractive");
    await delay(500);
    await evaluate(`document.querySelector('[aria-label="Close preflight alerts"]').closest('[role=dialog]').setAttribute('data-invoice-preflight','true')`);
    await pointerClick('[data-invoice-preflight] input[type="checkbox"]');
    await pointerClick('[aria-label="Close preflight alerts"]');
    await delay(350);
    await pointerClick('#loadNumber');
    await send("Input.insertText", {text:"UI-REGRESSION-1"});
    await delay(100);
    await pointerClick('#rateAmount');
    await delay(200);
    const blurOpenedDialog = await evaluate(`!!document.querySelector('[aria-label="Close preflight alerts"]')`);
    if (process.env.INVOICE_CREATE_BASELINE !== "1" && blurOpenedDialog) throw new Error("Field blur stole focus with a preflight dialog");
    if (await evaluate(`!!document.querySelector('[aria-label="Close preflight alerts"]')`)) {
      await pointerClick('[aria-label="Close preflight alerts"]');
      await delay(250);
      await pointerClick('#rateAmount');
    }
    await send("Input.insertText", {text:"100"});
    // Blurring a field must not steal the submit click by opening a dialog.
    await evaluate(`document.querySelector('#rateAmount').blur()`);
    await delay(200);
    if (await evaluate(`!!document.querySelector('[aria-label="Close preflight alerts"]')`)) await pointerClick('[aria-label="Close preflight alerts"]');
    await evaluate(`(() => {
      for(const input of document.querySelectorAll('[aria-label^="Upload Rate Confirmation"] input[type=file], [aria-label^="Upload Bill of Lading"] input[type=file]')){
        const data=new DataTransfer();data.items.add(new File(['%PDF-1.4\\n%%EOF'],'regression.pdf',{type:'application/pdf'}));
        input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      }
    })()`);
    await delay(300);
    invoiceCreate = await evaluate(`(() => {const submit=document.querySelector('.ff-create-invoice-dialog button[type=submit]');return {
      beforeReview:{disabled:submit.disabled,debug:window.__invoiceVerify.debug.at(-1),blockers:document.querySelector('[data-testid="invoice-submit-blockers"]')?.innerText},
      reviewAvailable:!!document.querySelector('[data-testid="review-invoice-alerts"]')
    };})()`);
    console.log(JSON.stringify({invoiceCreate}));
    if (process.env.INVOICE_CREATE_BASELINE !== "1") {
      if (!invoiceCreate.reviewAvailable) throw new Error("Disabled invoice has no way to review its alerts");
      await pointerClick('[data-testid="review-invoice-alerts"]');
      await delay(180);
      await evaluate(`document.querySelector('[aria-label="Close preflight alerts"]').closest('[role=dialog]').setAttribute('data-invoice-preflight','true')`);
      await pointerClick('[data-invoice-preflight] input[type=checkbox]');
      await pointerClick('[aria-label="Close preflight alerts"]');
      await delay(350);
      invoiceCreate.afterReview = await evaluate(`({disabled:document.querySelector('.ff-create-invoice-dialog button[type=submit]').disabled})`);
      if (invoiceCreate.afterReview.disabled) throw new Error("Invoice submit stayed disabled after required acknowledgement");
      // Existing required paperwork rules must still be enforced.
      await pointerClick('[aria-label="Remove Rate Confirmation"]');
      await delay(100);
      invoiceCreate.withoutPaperwork = await evaluate(`({disabled:document.querySelector('.ff-create-invoice-dialog button[type=submit]').disabled,blockers:document.querySelector('[data-testid="invoice-submit-blockers"]')?.innerText})`);
      if (!invoiceCreate.withoutPaperwork.disabled || !invoiceCreate.withoutPaperwork.blockers.includes("Upload the Rate Confirmation PDF")) throw new Error("Required document validation changed");
      await evaluate(`(() => {const input=document.querySelector('[aria-label^="Upload Rate Confirmation"] input[type=file]');const data=new DataTransfer();data.items.add(new File(['%PDF-1.4\\n%%EOF'],'regression.pdf',{type:'application/pdf'}));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await delay(200);
      await pointerClick('.ff-create-invoice-dialog button[type=submit]');
      await delay(250);
      invoiceCreate.submission = await evaluate(`({count:window.__invoiceVerify.submits,...window.__invoiceVerify.submitted})`);
      if (invoiceCreate.submission.count !== 1 || invoiceCreate.submission.metadata.loadNumber !== "UI-REGRESSION-1" || invoiceCreate.submission.metadata.amount !== "100" || !invoiceCreate.submission.rateConfirmation || !invoiceCreate.submission.billOfLading) throw new Error("Invoice field wiring/submission regression");
      console.log(JSON.stringify({invoiceCreate}));
    }
    const shot = await send("Page.captureScreenshot", {format:"jpeg",quality:65});
    await writeFile(`${out}/invoice-create.jpg`,Buffer.from(shot.data,"base64"));
    await writeFile(`${out}/invoice-create-results.json`,JSON.stringify(invoiceCreate,null,2));
  }
  let sheets;
  if (process.env.SHEETS_VERIFY === "1") {
    sheets = await evaluate(`(async () => {
      const response = await fetch('/api/invoices/funding/queue?page=1&pageSize=15', {credentials:'include'});
      const data = await response.json();
      const first = data.rows?.[0];
      const detailResponse = first ? await fetch('/api/invoices/'+first.id+'/detail', {credentials:'include'}) : null;
      const detailPayload = detailResponse?.ok ? await detailResponse.json() : null;
      const detail = detailPayload?.invoice ?? detailPayload;
      const headers = [...document.querySelectorAll('.ff-data-table thead th')].map(el=>el.textContent.trim());
      const row = document.querySelector('.ff-data-table tbody tr');
      const actions = row?.lastElementChild;
      const buttons = [...(actions?.querySelectorAll('button')??[])];
      return {
        total:data.total,
        firstRows:(data.rows??[]).slice(0,3).map(r=>({id:r.id,invoiceNumber:r.invoiceNumber,status:r.status,submittedByName:r.submittedByName,submittedAt:r.submittedAt})),
        firstDetail:detail ? {id:detail.id,invoiceNumber:detail.invoiceNumber,status:detail.status,submittedBy:detail.submittedBy,submittedAt:detail.submittedAt,createdAt:detail.createdAt,dataOrigin:detail.dataOrigin}:null,
        headers, firstRenderedCells:[...(row?.children??[])].map(el=>el.textContent.trim()),
        rowBackground:row?getComputedStyle(row).backgroundColor:null,
        hovered:row?.matches(':hover'),selectedCheckbox:row?.querySelector('[role=checkbox]')?.getAttribute('data-state'),
        actionLayout:actions?{width:actions.getBoundingClientRect().width,wrap:getComputedStyle(actions.firstElementChild).flexWrap,gap:getComputedStyle(actions.firstElementChild).gap}:null,
        buttons:buttons.map(b=>({text:b.textContent.trim()||b.getAttribute('aria-label'),height:b.getBoundingClientRect().height,top:b.getBoundingClientRect().top}))
      };
    })()`);
    const statusIndex = sheets.headers.indexOf("Status");
    const expectedStatus = sheets.firstRows[0]?.status.replace(/_/g, " ").replace(/^\w/, letter => letter.toUpperCase());
    sheets.ok = statusIndex >= 0 && sheets.firstRenderedCells[statusIndex] === expectedStatus &&
      sheets.actionLayout?.wrap === "nowrap" && sheets.actionLayout?.gap === "8px" &&
      sheets.buttons.length > 0 && sheets.buttons.every(b => b.height === 32 && Math.abs(b.top - sheets.buttons[0].top) < 1);
    if (!sheets.ok) process.exitCode = 1;
    await evaluate("document.querySelector('.ff-data-table tbody tr td:last-child')?.scrollIntoView({block:'center',inline:'end',behavior:'instant'})");
    const hoverPoint = await evaluate("(()=>{const r=document.querySelector('.ff-data-table tbody tr td:last-child').getBoundingClientRect();return{x:r.left+8,y:r.top+8}})()");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
    sheets.hoverBackground = await evaluate("getComputedStyle(document.querySelector('.ff-data-table tbody tr')).backgroundColor");
    console.log(JSON.stringify({ sheetsVerification: sheets }));
    const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    await writeFile(`${out}/sheets-actions.jpg`, Buffer.from(image.data, "base64"));
  }
  let notices;
  if (process.env.NEU_NOTICE_VERIFY === "1") {
    await evaluate("history.pushState({},'', '/neu-preview');dispatchEvent(new PopStateEvent('popstate'))");
    await delay(1200);
    await evaluate("document.querySelector('[aria-label=\"Notice severity samples\"]')?.scrollIntoView({block:'center',behavior:'instant'})");
    await pointerClick('[data-testid="notice-sample-ack"] input[type="checkbox"]');
    await pointerClick('[aria-label="Sample acknowledgement reason"]');
    await send("Input.insertText", { text: "Reviewed in browser test" });
    notices = await evaluate(`({
      styles:[...document.querySelectorAll('[data-testid^="notice-sample-"]')].map(el=>{
        const s=getComputedStyle(el),title=getComputedStyle(el.querySelector('.neu-notice-title'));
        return {severity:el.dataset.neuNotice,background:s.backgroundColor,left:s.borderLeftWidth,top:s.borderTopWidth,padding:s.paddingTop,inset:s.boxShadow.includes('inset'),title:title.color};
      }),
      checked:document.querySelector('[data-testid="notice-sample-ack"] input').checked,
      reason:document.querySelector('[aria-label="Sample acknowledgement reason"]').value
    })`);
    const ok = notices.styles.length === 3 && notices.styles.every(s => s.background === "rgb(224, 224, 224)" && s.left === "4px" && s.top === "0px" && s.padding === "16px" && s.inset) &&
      notices.checked && notices.reason === "Reviewed in browser test";
    notices.ok = ok;
    if (!ok) process.exitCode = 1;
    console.log(JSON.stringify({ noticeVerification: notices }));
    await evaluate("document.querySelector('[aria-label=\"Notice severity samples\"]')?.scrollIntoView({block:'center',behavior:'instant'})");
    const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 75 });
    await writeFile(`${out}/notice-severities.jpg`, Buffer.from(image.data, "base64"));
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   const mobileRoute = process.env.NEU_NOTICE_VERIFY === "1" ? "/neu-preview" :
     process.env.NEU_SMOKE_ROUTES ? routes[0] : "/client-email?tab=log";
   await evaluate(`history.pushState({},'', ${JSON.stringify(mobileRoute)});dispatchEvent(new PopStateEvent('popstate'))`);
  await delay(1500);
  if (process.env.NEU_NOTICE_VERIFY === "1") {
    await evaluate("document.querySelector('[aria-label=\"Notice severity samples\"]')?.scrollIntoView({block:'start',behavior:'instant'})");
  }
  const mobile = await evaluate(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+2,modalCount:document.querySelectorAll('[role=dialog]').length})`);
  const image = await send("Page.captureScreenshot", { format: "jpeg", quality: 65, captureBeyondViewport: false });
  await writeFile(`${out}/email-mobile.jpg`, Buffer.from(image.data, "base64"));
  if (process.env.PRODUCTION_PERFORMANCE_VERIFY === "1") {
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate("/expenses");
    const buttonFound = await evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find(button => /\\b(?:New|Add|Create)\\s+Expense\\b/i.test(button.textContent));
      button?.setAttribute('data-performance-expense-open', '');
      return Boolean(button);
    })()`);
    if (!buttonFound) throw new Error("Expense creation control missing");
    await pointerClick("[data-performance-expense-open]");
    await delay(400);
    if (!await evaluate("Boolean(document.querySelector('[role=dialog]'))")) throw new Error("Expense dialog did not open");
    const selectFound = await evaluate(`(() => {
      const button = document.querySelector('[role=dialog] button[role=combobox]');
      button?.setAttribute('data-performance-expense-select', '');
      return Boolean(button);
    })()`);
    if (selectFound) {
      await pointerClick("[data-performance-expense-select]");
      await delay(150);
      if (!await evaluate("Boolean(document.querySelector('[role=listbox]'))")) throw new Error("Expense selector did not open");
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    }
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await delay(400);
    if (await evaluate("Boolean(document.querySelector('[role=dialog][data-state=open]'))")) throw new Error("Expense dialog did not close");
    console.log(JSON.stringify({ expenseDialogOpenClose: true, expenseSelectorChecked: selectFound, noExpenseSubmitted: true }));
  }
  await writeFile(`${out}/browser-results.json`, JSON.stringify({ results, mobile, notices, sheets }, null, 2));
  if (results.some(result => !result.skipped && !result.ok) || mobile.overflow) process.exitCode = 1;
} catch (error) {
  // Fixed local messages only; never dump browser protocol payloads or stderr.
  console.error(error instanceof Error ? error.message : "Browser verification failed");
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill("SIGKILL");
  await delay(200);
  await rm(profile, { recursive: true, force: true });
}
