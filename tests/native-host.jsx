/* Opt-in native fixture. Launch only in a fresh AE process (-m). Never opens or closes projects.
 * Caller sets AELM_NATIVE_RESULT to an absolute output JSON path before $.evalFile(this file).
 * This deliberately creates disposable comp/layers and leaves them available for inspection.
 */
(function () {
    if (typeof AELM_NATIVE_RESULT !== "string") throw Error("Set AELM_NATIVE_RESULT before running the fixture.");
    var report={hostVersion:String(app.version),checks:[],passed:false}, resultFile=new File(AELM_NATIVE_RESULT);
    function quote(s) { return '"'+String(s).replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\r/g,"\\r").replace(/\n/g,"\\n")+'"'; }
    function check(ok,label) { report.checks.push({name:label,passed:!!ok});if(!ok) throw Error(label); }
    function call(method,args) {
        // The fixture creates its own trusted object; eval parses the host JSON only inside this test.
        var text="{}", key, parts=[];
        for(key in args) if(args.hasOwnProperty(key)) parts.push(quote(key)+":"+(typeof args[key]==="string" ? quote(args[key]) : String(args[key])));
        text="{"+parts.join(",")+"}";
        return eval("("+AELM.dispatch(method,text)+")");
    }
    try {
        check(!!app.project && !app.project.file && app.project.numItems===0,"Fresh empty unsaved project required");
        $.evalFile(new File(new File($.fileName).parent.parent.fsName+"/extension/host/aelm.jsx"));
        var ident=call("identity",{}).data;
        var empty=call("inspect",{scope:"activeComp"});check(empty.ok && empty.data.activeComp===null,"Empty composition observation");
        var comp=app.project.items.addComp("AELM_NATIVE_FIXTURE",640,360,1,2,24);comp.openInViewer();
        var observed=call("inspect",{scope:"activeComp"});check(observed.ok && observed.data.comp.width===640,"Composition authored read");
        var command={id:"native_fixture_once",title:"Create fixture null",expectedProjectToken:ident.projectToken,source:'var c=app.project.activeItem; var n=c.layers.addNull(); n.name="AELM_TEST_CONTROL"; return {name:n.name};'};
        var applied=call("execute",command);check(applied.ok && comp.numLayers===1,"General script execution");
        var duplicate=call("execute",command);check(!duplicate.ok && duplicate.error.code==="already_consumed" && comp.numLayers===1,"Duplicate execution rejected");
        var readback=call("inspect",{scope:"activeComp"});check(readback.ok && readback.data.layers[0].name==="AELM_TEST_CONTROL","Live readback");
        $.evalFile(new File(new File($.fileName).parent.parent.fsName+"/extension/host/aelm.jsx"));
        check(call("execute",command).error.code==="already_consumed","Host reload retains consumed identity");
        report.passed=true;
    } catch(ex) { report.error=String(ex); }
    var checks=[],i;for(i=0;i<report.checks.length;i++) checks.push('{"name":'+quote(report.checks[i].name)+',"passed":'+report.checks[i].passed+'}');
    var output='{"hostVersion":'+quote(report.hostVersion)+',"passed":'+report.passed+',"checks":['+checks.join(",")+'],"error":'+(report.error ? quote(report.error) : "null")+'}';
    resultFile.encoding="UTF-8";
    if(!resultFile.open("w")) throw Error("Cannot write native fixture result. Check script file permissions.");
    resultFile.write(output);resultFile.close();
}());
