'use strict';
const crypto = require('crypto');
const {createArchive} = require('./history');
const defaultProtocol = require('./protocol');
const defaultTransport = require('./transport');
const {buildContext} = require('./context');

class Controller {
  constructor(options) {
    this.bridge = options.bridge;
    this.store = options.store;
    this.transport = options.transport || defaultTransport;
    this.protocol = options.protocol || defaultProtocol;
    this.onChange = options.onChange || function () {};
    this.onProgress = options.onProgress || function () {};
    this.archive = createArchive();
    this.connection = {baseUrl:'',token:'',model:''};
    this.identity = null;
    this.busy = false;
    this.autoRun = false;
    this.pending = null;
    this.error = '';
    this.historyStatus = 'Unsaved project — history is in memory';
    this.maxSteps = options.maxSteps || 24;
    this.maxContextChars = options.maxContextChars || 96000;
    this._epoch = 0;
  }
  changed() { this.onChange(this); }
  configure(settings) {
    if (this.busy) throw new Error('Stop the current request before changing the connection.');
    this.connection = {baseUrl:this.transport.normalizeBaseUrl(settings.baseUrl),token:settings.token,model:settings.model};
    this.error = ''; this.changed();
  }
  async syncProject() {
    const response = await this.bridge.identity();
    if (!response.ok) throw new Error(response.error.message);
    const next = response.data;
    if (!this.identity || next.projectToken !== this.identity.projectToken || next.projectPath !== this.identity.projectPath) {
      const sameProject = this.identity && next.projectToken === this.identity.projectToken;
      const binding = this.store.bind(next.projectPath || '', sameProject ? {carry:this.archive} : {});
      this.archive = binding.archive;
      this.identity = next;
      this.historyStatus = this.store.path ? 'History: ' + this.store.path : 'Unsaved project — history is in memory';
      this.persist();
      this.changed();
    } else { this.identity = next; }
    return next;
  }
  persist() {
    this.archive.updatedAt = new Date().toISOString();
    this.store.save(this.archive);
  }
  async refreshTarget() {
    const response=await this.bridge.identity();
    if(!response.ok) throw new Error(response.error.message);
    const next=response.data;
    if(!this.identity || next.projectToken!==this.identity.projectToken) throw new Error('The active project changed. Send a new request for that project.');
    if(next.projectPath!==this.identity.projectPath) {
      this.store.bind(next.projectPath||'',{carry:this.archive});
      this.identity=next;
      this.historyStatus=this.store.path?'History: '+this.store.path:'Unsaved project — history is in memory';
    }
    return next;
  }
  async send(text) {
    if (this.busy || !text.trim()) return;
    await this.begin(text.trim());
  }
  async retry() {
    if (this.busy || !this.archive.messages.length) return;
    await this.begin(null);
  }
  async inspectLocal() {
    if (this.busy) return;
    this.busy=true; this.stopped=false; this.error=''; this.changed();
    try {
      await this.syncProject();
      if(this.stopped) return;
      const id='local-'+crypto.randomBytes(12).toString('hex');
      const args={scope:'activeComp',offset:0,limit:10};
      this.archive.messages.push({role:'user',content:'Inspect the active composition locally. Do not modify anything or render.'});
      this.archive.messages.push({role:'assistant',content:'Reading the active composition directly from After Effects.',tool_calls:[{id,type:'function',function:{name:'ae_inspect',arguments:JSON.stringify(args)}}]});
      await this.perform({id,name:'ae_inspect',args});
    } catch(error) { this.error=error.message; this.settleUnanswered(); }
    finally { this.busy=false; this.changed(); }
  }
  async begin(text) {
    if (!this.connection.model || !this.connection.token) throw new Error('Connect to your studio and choose a model first.');
    this.busy = true; this.error = ''; this.stopped = false;
    const epoch = ++this._epoch;
    this.abort = new AbortController();
    this.changed();
    try {
      await this.syncProject();
      if(this.stopped) return;
      if (text !== null) this.archive.messages.push({role:'user',content:text});
      this.persist(); this.changed();
      for (let step = 0; step < this.maxSteps; step++) {
        if (this.stopped || epoch !== this._epoch) break;
        const context = buildContext(this.archive.messages,{system:this.protocol.SYSTEM_PROMPT,maxChars:this.maxContextChars});
        this.onProgress({phase:'model',detail:context.compactedResults ? 'Requesting the model with smaller previews of large tool results. Exact commands and full results remain in local history.' : context.compacted ? 'Requesting the model; older turns omitted from this request. Full history remains local.' : 'Requesting the model.'});
        const result = await this.transport.request({baseUrl:this.connection.baseUrl,token:this.connection.token,
          path:'/api/chat/completions',body:{model:this.connection.model,messages:context.messages,tools:this.protocol.TOOLS,stream:true},
          signal:this.abort.signal,onProgress:p=>this.onProgress(p)});
        if (this.stopped || epoch !== this._epoch) break;
        await this.refreshTarget();
        if(this.stopped) break;
        const answer = this.protocol.parseCompletion(result.body,result.headers['content-type'] || '');
        const calls = this.protocol.validateToolCalls(answer.tool_calls || []);
        const seen = new Set(this.archive.receipts.map(r=>r.id));
        if (calls.some(c=>seen.has(c.id))) throw new Error('The model reused an earlier command ID. No commands from this response ran.');
        this.archive.messages.push(answer);
        this.persist(); this.changed();
        if (!calls.length) return;
        for (const call of calls) {
          if (this.stopped) {
            this.addToolResult(call.id,{ok:false,error:{code:'cancelled',message:'Stopped before execution.'}});
            continue;
          }
          await this.perform(call);
        }
        this.persist(); this.changed();
      }
      if (!this.stopped) this.error = 'This turn reached its step limit. Completed commands are recorded. Continue with a narrower request.';
    } catch (error) {
      this.error = this.stopped ? 'Stopped. Completed changes remain in After Effects.' : (error.message || 'Request failed.');
      // Settle every unanswered call without executing it, including a partially completed batch.
      this.settleUnanswered();
      try { this.persist(); } catch (saveError) { this.error += ' History was not saved: ' + saveError.message; }
    } finally {
      this.pending = null; this.busy = false; this.abort = null; this.changed();
    }
  }
  addToolResult(id,value) {
    this.archive.messages.push({role:'tool',tool_call_id:id,content:JSON.stringify(value)});
  }
  settleUnanswered() {
    const answered = new Set(this.archive.messages.filter(m=>m.role==='tool').map(m=>m.tool_call_id));
    for (const message of this.archive.messages) {
      for (const call of message.tool_calls || []) {
        if (!answered.has(call.id)) {
          const receipt = this.archive.receipts.find(r=>r.id===call.id);
          if (receipt && receipt.status==='running') receipt.status='unknown';
          if (receipt && receipt.status==='proposed') receipt.status='cancelled';
          this.addToolResult(call.id,{ok:false,error:{code:receipt && receipt.status==='unknown' ? 'unknown_outcome' : 'cancelled',
            message:'The turn stopped. Do not replay this command; inspect current state before proposing more work.'}});
          answered.add(call.id);
        }
      }
    }
  }
  async perform(call) {
    const script = call.name === 'ae_run_script';
    const target = await this.refreshTarget();
    if(this.stopped) {this.addToolResult(call.id,{ok:false,error:{code:'cancelled',message:'Stopped before execution.'}});return;}
    const receipt = {id:call.id,title:script ? call.args.title : 'Inspect ' + (call.args.scope || 'activeComp'),
      source:script ? call.args.source : JSON.stringify(call.args,null,2),kind:script?'script':'read',
      status:script?'proposed':'running',createdAt:new Date().toISOString(),targetProjectToken:target.projectToken};
    receipt.sourceHash = crypto.createHash('sha256').update(receipt.source).digest('hex');
    this.archive.receipts.push(receipt); this.persist(); this.changed();
    if (script) {
      const approved = this.autoRun || await new Promise(resolve=>{
        this.pending = {id:receipt.id,resolve};
        this.onProgress({phase:'approval',detail:'Review the exact script below. It runs with After Effects permissions.'}); this.changed();
      });
      this.pending = null;
      if (!approved || this.stopped) {
        receipt.status = this.stopped ? 'cancelled':'rejected';
        receipt.result = {ok:false,error:{code:receipt.status,message:'The script was not executed.'}};
        this.addToolResult(call.id,receipt.result); this.persist(); this.changed(); return;
      }
      receipt.authorization = this.autoRun ? 'auto-run':'manual';
      await this.refreshTarget();
      if(this.stopped) {receipt.status='cancelled';this.addToolResult(call.id,{ok:false,error:{code:'cancelled',message:'Stopped before execution.'}});this.persist();return;}
      receipt.status='running'; receipt.startedAt=new Date().toISOString();
      this.persist(); this.changed();
    }
    this.onProgress({phase:'host',detail:script ? 'Running the approved script in After Effects. Stop prevents subsequent steps; it cannot guarantee interruption of this script.' : 'Reading live project data. No preview or render requested.'});
    try {
      receipt.result = script ? await this.bridge.execute({id:receipt.id,source:receipt.source,title:receipt.title,expectedProjectToken:receipt.targetProjectToken}) : await this.bridge.inspect(call.args);
      receipt.status = receipt.result.ok ? 'completed':'failed';
    } catch (error) {
      receipt.status = script && error.outcome==='unknown' ? 'unknown':'failed';
      receipt.result = {ok:false,error:{code:error.code || 'host_error',message:error.message,possiblyModified:receipt.status==='unknown'}};
    }
    receipt.completedAt=new Date().toISOString();
    this.addToolResult(call.id,receipt.result);
    // Bind Save As before the next disk write, while keeping a switched project's result in its originating archive.
    const after=await this.bridge.identity().catch(()=>null);
    if(after && after.ok && after.data.projectToken===this.identity.projectToken && after.data.projectPath!==this.identity.projectPath) await this.refreshTarget();
    this.persist(); this.changed();
    if (receipt.status==='unknown') throw new Error('The script outcome is unknown. It will not be retried. Inspect After Effects before continuing.');
    if(script && !receipt.result.ok && receipt.result.error && receipt.result.error.possiblyModified) throw new Error(receipt.result.error.message + ' [' + receipt.result.error.code + '] Earlier edits may remain. The remaining batch was stopped; inspect the project before continuing.');
    if(after && after.ok && after.data.projectToken!==this.identity.projectToken) throw new Error('The script changed the active project. Its outcome was recorded; send a new request for the new project.');
  }
  decide(id,approved) {
    if (!this.pending || this.pending.id!==id) return false;
    const pending=this.pending; this.pending=null; pending.resolve(approved===true); this.changed(); return true;
  }
  stop() {
    this.stopped=true;
    if(this.abort) this.abort.abort();
    if(this.pending) this.decide(this.pending.id,false);
    this.onProgress({phase:'stopping',detail:'Stopping subsequent steps. An already dispatched AE script may still be running.'});
  }
}
module.exports={Controller};
