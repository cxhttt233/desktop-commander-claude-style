import util from 'util';
import { readFileSync } from 'fs';
import { measureArgs } from '../dc-traffic-meter.js';

class DCTerminalStatusLine {
    constructor() {
        this.enabled = !!process.stdout.isTTY && process.env.DC_STATUS_LINE !== '0';
        this.active = false;
        this.patched = false;
        this.height = 1;
        this.rows = process.stdout.rows || 30;
        this.cols = process.stdout.columns || 100;
        this.headerText = '';
        this.logTop = 1;
        this.logBottom = Math.max(1, this.rows - 1);
        this.rawWrite = process.stdout.write.bind(process.stdout);
        this.originalConsole = new Map();

        this.currentIn = 0;
        this.currentOut = 0;
        this.targetIn = 0;
        this.targetOut = 0;
        this.fromIn = 0;
        this.fromOut = 0;
        this.currentCalls = 0;
        this.targetCalls = 0;
        this.fromCalls = 0;

        this.busy = 0;
        this.settling = false;
        this.frame = 0;
        this.frames = ['✻','✻','✻','✻','✻','✻'];
        this.markStyles = ['1;96','96','1;97','97','96','1;96'];
        this.lastFrameAt = 0;
        this.verbs = this.loadVerbs();
        this.currentVerb = 'DC';
        this.lastBusyVerb = '';
        this.nextVerbAt = 0;

        this.animationStarted = 0;
        this.animationDuration = 0;
        this.animating = false;

        this.lastIn = '';
        this.lastOut = '';
        this.lastCalls = '';
        this.lastMark = '';
        this.lastStatus = '';

        this.timer = setInterval(() => this.tick(), 33);
        this.timer.unref?.();
        process.stdout.on?.('resize', () => this.handleResize());
        process.on('exit', () => this.dispose());
    }

    loadVerbs() {
        try {
            const root = process.env.LOCALAPPDATA || '';
            const file = `${root}\\DesktopCommander\\claude-spinner-verbs.json`;
            const values = JSON.parse(readFileSync(file, 'utf8'));
            if (Array.isArray(values) && values.length >= 20) return values.filter(v => typeof v === 'string' && v.length > 0);
        } catch { }
        return ['Pondering','Clauding','Combobulating','Crunching','Noodling','Ruminating','Tinkering','Canoodling','Brewing','Synthesizing'];
    }

    pickVerb() {
        if (!this.verbs.length) return 'Working';
        const short = this.verbs.filter(v => v.length <= 8);
        const pool = short.length ? short : this.verbs;
        let next = pool[Math.floor(Math.random() * pool.length)];
        if (pool.length > 1 && next === this.currentVerb) {
            next = pool[(pool.indexOf(next) + 1) % pool.length];
        }
        return next;
    }

    format(value) {
        const n = Math.max(0, Math.round(Number(value) || 0));
        if (n < 1000) return String(n);
        if (n < 1000000) {
            const v = n / 1000;
            const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0);
            return s.replace(/\.0+$/, '') + 'K';
        }
        const v = n / 1000000;
        const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0);
        return s.replace(/\.0+$/, '') + 'M';
    }

    animationMs(from, to) {
        if (to <= from) return 500;
        const decades = Math.log10((to + 1) / (from + 1));
        return Math.max(700, Math.min(5000, decades * 850));
    }

    interpolated(from, to, p) {
        if (to <= from) return to;
        const a = Math.max(1, from + 1);
        const b = Math.max(a, to + 1);
        const curved = p + 0.10 * Math.sin(Math.PI * p);
        const value = Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * curved) - 1;
        return Math.min(to, Math.max(from, Math.round(value)));
    }

    setupRegion() {
        if (!this.enabled) return;
        this.rows = process.stdout.rows || this.rows || 30;
        this.cols = process.stdout.columns || this.cols || 100;
        this.logTop = this.headerText ? 2 : 1;
        this.logBottom = Math.max(this.logTop, this.rows - 1);
        this.rawWrite(`\x1b[${this.logTop};${this.logBottom}r`);
        this.rawWrite('\x1b[?25l');
    }

    setHeader(text) {
        this.headerText = String(text || '').trim();
        if (!this.enabled || !this.active) return;
        this.setupRegion();
        this.drawHeader();
        this.rawWrite(`\x1b[${this.logBottom};1H`);
    }

    drawHeader() {
        if (!this.enabled || !this.active || !this.headerText) return;
        const maxChars = Math.max(8, Math.floor((this.cols - 4) / 2));
        const text = Array.from(this.headerText).slice(0, maxChars).join('');
        this.rawWrite('\x1b[1;1H\x1b[2K');
        this.writeAt(1, 2, text, '1;97');
    }

    layout() {
        return {
            mark: 2,
            status: 4,
            statusWidth: 8,
            downArrow: 13,
            downValue: 15,
            downUnit: 22,
            upArrow: 26,
            upValue: 28,
            upUnit: 35,
            dot: 39,
            calls: 41,
        };
    }

    writeAt(row, col, text, style = '0') {
        this.rawWrite(`\x1b[${row};${col}H\x1b[${style}m${text}\x1b[0m`);
    }

    writeField(row, col, width, text, style) {
        const value = String(text).slice(0, width).padEnd(width, ' ');
        this.rawWrite(`\x1b[${row};${col}H\x1b[${style}m${value}\x1b[0m`);
    }

    drawStatic() {
        if (!this.enabled || !this.active) return;
        const row = this.rows;
        const l = this.layout();
        this.rawWrite(`\x1b[${row};1H\x1b[2K`);
        this.writeAt(row, l.downArrow, '↓', '1;96');
        this.writeAt(row, l.downUnit, 'tok', '96');
        this.writeAt(row, l.upArrow, '↑', '1;92');
        this.writeAt(row, l.upUnit, 'tok', '92');
        this.writeAt(row, l.dot, '·', '1;97');
        this.lastMark = '';
        this.lastIn = '';
        this.lastOut = '';
        this.lastCalls = '';
        this.lastStatus = '';
        this.writeMark(true);
        this.writeStatus(true);
        this.writeValues(true);
    }

    isVisuallyBusy() {
        return this.busy > 0 || this.settling;
    }

    currentMark() {
        return this.isVisuallyBusy() ? this.frames[this.frame] : '✻';
    }

    writeMark(force = false) {
        if (!this.enabled || !this.active) return;
        const mark = this.currentMark();
        const style = this.isVisuallyBusy()
            ? this.markStyles[this.frame % this.markStyles.length]
            : '1;96';
        const key = `${mark}|${style}`;
        if (!force && key === this.lastMark) return;
        this.writeAt(this.rows, this.layout().mark, mark, style);
        this.lastMark = key;
    }

    currentStatus() {
        return this.isVisuallyBusy() ? this.currentVerb : 'DC idle';
    }

    writeStatus(force = false) {
        if (!this.enabled || !this.active) return;
        const status = this.currentStatus();
        if (!force && status === this.lastStatus) return;
        const l = this.layout();
        this.writeField(this.rows, l.status, l.statusWidth, status, '1;97');
        this.lastStatus = status;
    }

    writeValues(force = false) {
        if (!this.enabled || !this.active) return;
        const row = this.rows;
        const l = this.layout();
        const input = this.format(this.currentIn);
        const output = this.format(this.currentOut);
        const calls = String(Math.max(0, Math.round(this.currentCalls)));
        if (force || input !== this.lastIn) {
            this.writeField(row, l.downValue, 7, input, '1;96');
            this.lastIn = input;
        }
        if (force || output !== this.lastOut) {
            this.writeField(row, l.upValue, 7, output, '1;92');
            this.lastOut = output;
        }
        if (force || calls !== this.lastCalls) {
            this.writeField(row, l.calls, 5, calls, '1;97');
            this.lastCalls = calls;
        }
    }

    writeLog(args, level) {
        if (!this.active) {
            const original = this.originalConsole.get(level);
            if (original) original(...args);
            return;
        }
        const text = util.formatWithOptions({ colors: true, depth: 6 }, ...args);
        const normalized = String(text).replace(/\r\n/g, '\n');
        this.rawWrite(`\x1b[${this.logBottom};1H`);
        this.rawWrite(normalized);
        if (!normalized.endsWith('\n')) this.rawWrite('\n');
    }

    patchConsole() {
        if (this.patched || !this.enabled) return;
        this.patched = true;
        for (const name of ['log','info','warn','error','debug']) {
            const original = console[name].bind(console);
            this.originalConsole.set(name, original);
            console[name] = (...args) => this.writeLog(args, name);
        }
    }

    activate() {
        if (!this.enabled || this.active) return;
        this.active = true;
        this.patchConsole();
        this.setupRegion();
        this.drawHeader();
        this.drawStatic();
        this.rawWrite(`\x1b[${this.logBottom};1H`);
    }

    beginCall(toolArgs) {
        if (!this.enabled) return;
        const wasIdle = !this.isVisuallyBusy();
        this.busy += 1;
        this.settling = false;
        this.lastFrameAt = 0;
        if (wasIdle) {
            const now = Date.now();
            if (!this.lastBusyVerb || now >= this.nextVerbAt) {
                this.lastBusyVerb = this.pickVerb();
                this.nextVerbAt = now + 12000 + Math.floor(Math.random() * 8000);
            }
            this.currentVerb = this.lastBusyVerb;
        }

        let modelOutputTokens = 0;
        try {
            // Tool arguments are generated by the model, so they are model output.
            modelOutputTokens = measureArgs(toolArgs).textTokens;
        } catch { }

        this.fromIn = this.currentIn;
        this.fromOut = this.currentOut;
        this.fromCalls = this.currentCalls;
        this.targetIn = Math.max(this.targetIn, this.currentIn);
        this.targetOut = Math.max(this.targetOut, this.currentOut) + modelOutputTokens;
        this.targetCalls = Math.max(this.targetCalls, this.currentCalls) + 1;
        this.animationDuration = Math.max(700, Math.min(1800, this.animationMs(this.fromIn, this.targetIn)));
        this.animationStarted = Date.now();
        this.animating = true;

        this.writeMark(true);
        this.writeStatus(true);
    }

    finishCall(stats) {
        if (!this.enabled) return;
        this.busy = Math.max(0, this.busy - 1);

        if (!stats || typeof stats !== 'object') {
            if (this.busy === 0) {
                this.settling = false;
                this.currentVerb = 'DC';
                this.writeMark(true);
                this.writeStatus(true);
            }
            return;
        }

        this.fromIn = this.currentIn;
        this.fromOut = this.currentOut;
        this.fromCalls = this.currentCalls;

        // MCP inputTokens are tool arguments (model output); outputTokens are
        // tool results (model input). Display from the model's perspective.
        const serverIn = Number(stats.sessionOutputTokens ?? stats.outputTokens ?? 0) || 0;
        const serverOut = Number(stats.sessionInputTokens ?? stats.inputTokens ?? 0) || 0;
        const serverCalls = Number(stats.sessionCalls ?? stats.calls ?? 0) || 0;
        this.targetIn = Math.max(this.targetIn, serverIn, this.currentIn);
        this.targetOut = Math.max(this.targetOut, serverOut, this.currentOut);
        this.targetCalls = Math.max(this.targetCalls, serverCalls, this.currentCalls);

        const d1 = this.animationMs(this.fromIn, this.targetIn);
        const d2 = this.animationMs(this.fromOut, this.targetOut);
        this.animationDuration = Math.max(500, Math.min(2200, Math.max(d1, d2)));
        this.animationStarted = Date.now();
        this.animating = true;
        this.settling = this.busy === 0;
        if (this.settling) {
            // Keep the current verb through the short completion animation.
            // Preserve nextVerbAt so consecutive short calls reuse the same word.
        }
        this.writeMark(true);
        this.writeStatus(true);
    }

    tick() {
        if (!this.enabled || !this.active) return;
        const now = Date.now();
        const visualBusy = this.isVisuallyBusy();
        if (visualBusy && now - this.lastFrameAt >= 90) {
            this.frame = (this.frame + 1) % this.frames.length;
            this.lastFrameAt = now;
            this.writeMark();
        }
        if (visualBusy && !this.settling && now >= this.nextVerbAt) {
            this.lastBusyVerb = this.pickVerb();
            this.currentVerb = this.lastBusyVerb;
            this.nextVerbAt = now + 12000 + Math.floor(Math.random() * 8000);
            this.writeStatus();
        }

        if (!this.animating) return;
        const p = Math.min(1, (now - this.animationStarted) / this.animationDuration);
        this.currentIn = this.interpolated(this.fromIn, this.targetIn, p);
        this.currentOut = this.interpolated(this.fromOut, this.targetOut, p);
        const callsEase = 1 - Math.pow(1 - p, 3);
        this.currentCalls = this.fromCalls + (this.targetCalls - this.fromCalls) * callsEase;
        this.writeValues();

        if (p >= 1) {
            this.currentIn = this.targetIn;
            this.currentOut = this.targetOut;
            this.currentCalls = this.targetCalls;
            this.animating = false;
            this.writeValues(true);
            if (this.busy === 0) {
                this.settling = false;
                this.currentVerb = 'DC';
                this.writeMark(true);
                this.writeStatus(true);
            }
        }
    }

    handleResize() {
        if (!this.active) return;
        this.setupRegion();
        this.drawHeader();
        this.drawStatic();
        this.rawWrite(`\x1b[${this.logBottom};1H`);
    }

    dispose() {
        if (!this.enabled || !this.active) return;
        this.active = false;
        clearInterval(this.timer);
        this.rawWrite('\x1b[r');
        this.rawWrite('\x1b[?25h');
        this.rawWrite(`\x1b[${this.rows};1H\n`);
    }
}

export const dcTerminalStatus = new DCTerminalStatusLine();

