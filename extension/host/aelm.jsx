/* Ae-lm host bridge. ES3 syntax: this file executes in AE's ExtendScript engine. */
if (typeof AELM === "undefined") {
    var AELM = (function () {
        var generation = String(new Date().getTime()) + "-" + String(Math.random()).substring(2);
        var project = null, projectSerial = 0, used = {}, usedCount = 0;

        function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
        function quote(value) {
            return '"' + String(value).replace(/[\\"\x00-\x1f\u2028\u2029]/g, function (ch) {
                var escapes = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
                if (own(escapes, ch)) return escapes[ch];
                var hex = ch.charCodeAt(0).toString(16); return "\\u" + ("0000" + hex).slice(-4);
            }) + '"';
        }
        function stringify(value, depth, seen, limits) {
            depth = depth || 0; seen = seen || []; limits = limits || {partial:false};
            if (value === null || typeof value === "undefined") return "null";
            if (typeof value === "string") { if(value.length>12000) limits.partial=true; return quote(value.length>12000 ? value.substring(0,12000)+" [text truncated]" : value); }
            if (typeof value === "number") return isFinite(value) ? String(value) : "null";
            if (typeof value === "boolean") return value ? "true" : "false";
            if (typeof value !== "object") { limits.partial=true; return quote("[unsupported value]"); }
            if (depth > 12) { limits.partial=true; return quote("[depth limit]"); }
            var i, parts = [], key;
            for (i = 0; i < seen.length; i++) if (seen[i] === value) { limits.partial=true; return quote("[circular]"); }
            seen.push(value);
            if (value instanceof Array) {
                if(value.length>500) limits.partial=true;
                for (i = 0; i < Math.min(value.length, 500); i++) parts.push(stringify(value[i], depth + 1, seen, limits));
                seen.pop(); return "[" + parts.join(",") + "]";
            }
            for (key in value) if (own(value, key)) {
                if (parts.length >= 200) { limits.partial=true; break; }
                parts.push(quote(key) + ":" + stringify(value[key], depth + 1, seen, limits));
            }
            seen.pop(); return "{" + parts.join(",") + "}";
        }
        // Strict JSON parser. AE does not consistently provide JSON.parse; never eval transport input.
        function parse(text) {
            var at = 0;
            function ws() { while (/\s/.test(text.charAt(at)) && at < text.length) at++; }
            function str() {
                var out = "", ch, code, map = {'"':'"', '\\':'\\', '/':'/', b:'\b', f:'\f', n:'\n', r:'\r', t:'\t'};
                at++;
                while (at < text.length) {
                    ch = text.charAt(at++);
                    if (ch === '"') return out;
                    if (ch === "\\") {
                        ch = text.charAt(at++);
                        if (ch === "u") { code = text.substr(at, 4); if (!/^[0-9a-fA-F]{4}$/.test(code)) throw Error("Invalid JSON escape"); out += String.fromCharCode(parseInt(code, 16)); at += 4; }
                        else if (own(map, ch)) out += map[ch]; else throw Error("Invalid JSON escape");
                    } else { if (ch.charCodeAt(0) < 32) throw Error("Invalid JSON string"); out += ch; }
                }
                throw Error("Unclosed JSON string");
            }
            function value(depth) {
                if (depth > 30) throw Error("JSON is too deeply nested");
                ws(); var c = text.charAt(at), out, key, match;
                if (c === '"') return str();
                if (c === "{") {
                    out = {}; at++; ws(); if (text.charAt(at) === "}") { at++; return out; }
                    while (at < text.length) {
                        ws(); if (text.charAt(at) !== '"') throw Error("Invalid JSON key"); key = str();
                        if (key === "__proto__" || key === "constructor" || key === "prototype" || own(out, key)) throw Error("Invalid JSON key");
                        ws(); if (text.charAt(at++) !== ":") throw Error("Invalid JSON object"); out[key] = value(depth + 1); ws(); c = text.charAt(at++);
                        if (c === "}") return out; if (c !== ",") throw Error("Invalid JSON object");
                    }
                }
                if (c === "[") {
                    out = []; at++; ws(); if (text.charAt(at) === "]") { at++; return out; }
                    while (at < text.length) { out.push(value(depth + 1)); ws(); c = text.charAt(at++); if (c === "]") return out; if (c !== ",") throw Error("Invalid JSON array"); }
                }
                match = /^(true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.substr(at));
                if (!match) throw Error("Invalid JSON value"); at += match[0].length;
                if (match[0] === "true") return true; if (match[0] === "false") return false; if (match[0] === "null") return null;
                out = Number(match[0]); if (!isFinite(out)) throw Error("Invalid number"); return out;
            }
            var result = value(0); ws(); if (at !== text.length) throw Error("Trailing JSON data"); return result;
        }
        function cut(value, limit) { return String(value).substring(0, limit || 2000); }
        function integer(value, fallback, min, max) {
            if (typeof value === "undefined") return fallback;
            if (typeof value !== "number" || value !== Math.floor(value) || value < min || value > max) throw Error("Invalid numeric argument");
            return value;
        }
        function identity() {
            if (project !== app.project) { project = app.project; projectSerial++; }
            return {projectToken: generation + ":" + projectSerial, projectPath: project && project.file ? project.file.fsName : null, hostVersion: String(app.version)};
        }
        function error(code, message, modified) { return {ok:false, error:{code:code, message:cut(message, 2000), possiblyModified:!!modified}}; }
        function instance(value, name) {
            try {
                if (name === "CompItem") return typeof CompItem !== "undefined" && value instanceof CompItem;
                if (name === "FolderItem") return typeof FolderItem !== "undefined" && value instanceof FolderItem;
                if (name === "FootageItem") return typeof FootageItem !== "undefined" && value instanceof FootageItem;
                if (name === "TextLayer") return typeof TextLayer !== "undefined" && value instanceof TextLayer;
                if (name === "ShapeLayer") return typeof ShapeLayer !== "undefined" && value instanceof ShapeLayer;
                if (name === "CameraLayer") return typeof CameraLayer !== "undefined" && value instanceof CameraLayer;
                if (name === "LightLayer") return typeof LightLayer !== "undefined" && value instanceof LightLayer;
                if (name === "AVLayer") return typeof AVLayer !== "undefined" && value instanceof AVLayer;
            } catch (_) {} return false;
        }
        function itemInfo(item) {
            // Avoid chained ternaries: ExtendScript can parse their association differently.
            var type = "item";
            if (instance(item,"CompItem")) type = "composition";
            else if (instance(item,"FolderItem")) type = "folder";
            else if (instance(item,"FootageItem")) type = "footage";
            return {id:item.id, name:cut(item.name, 500), type:type};
        }
        function layerInfo(layer) {
            var names = ["TextLayer","ShapeLayer","CameraLayer","LightLayer","AVLayer"], type = "Layer", i;
            for (i = 0; i < names.length; i++) if (instance(layer,names[i])) { type = names[i]; break; }
            var result = {index:layer.index, name:cut(layer.name,500), type:type, enabled:layer.enabled, locked:layer.locked, shy:layer.shy, inPoint:layer.inPoint, outPoint:layer.outPoint, startTime:layer.startTime, parentIndex:layer.parent ? layer.parent.index : null};
            try { result.id = layer.id; } catch (_) {}
            try { result.nullLayer = layer.nullLayer; result.threeDLayer = layer.threeDLayer; if (layer.source) result.sourceId = layer.source.id; } catch (_) {}
            return result;
        }
        function plainValue(value) {
            if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return typeof value === "string" ? cut(value,4000) : value;
            if (value instanceof Array) { var list = [], i; for (i=0;i<Math.min(64,value.length);i++) list.push(plainValue(value[i])); return list; }
            if (typeof TextDocument !== "undefined" && value instanceof TextDocument) return {text:cut(value.text,4000),font:cut(value.font,200),fontSize:value.fontSize};
            if (typeof Shape !== "undefined" && value instanceof Shape) return {vertices:plainValue(value.vertices),inTangents:plainValue(value.inTangents),outTangents:plainValue(value.outTangents),closed:value.closed,verticesTruncated:value.vertices.length>64};
            return "[complex value omitted]";
        }
        function propertyInfo(prop) {
            var result = {name:cut(prop.name,500), matchName:cut(prop.matchName,500), index:prop.propertyIndex};
            if (prop.propertyType !== PropertyType.PROPERTY) { result.kind="group"; result.numProperties=prop.numProperties; return result; }
            result.kind="property"; result.numKeys=prop.numKeys; result.valueType=String(prop.propertyValueType);
            var expression = false, i, keys = [];
            try { expression = !!prop.expressionEnabled; if (prop.canSetExpression) { result.expression = cut(prop.expression || "",8000); result.expressionTruncated=(prop.expression || "").length>8000; result.expressionEnabled=expression; result.expressionError=cut(prop.expressionError || "",2000); } } catch (_) {}
            if (prop.numKeys) {
                for(i=1;i<=Math.min(prop.numKeys,20);i++) keys.push({index:i,time:prop.keyTime(i),value:plainValue(prop.keyValue(i))});
                result.keys=keys; result.keysTruncated=prop.numKeys>20;
            } else if (!expression && prop.propertyValueType !== PropertyValueType.NO_VALUE && prop.propertyValueType !== PropertyValueType.CUSTOM_VALUE) {
                try { result.authoredValue=plainValue(prop.value); } catch (_) { result.valueUnavailable=true; }
            }
            if (expression) result.evaluatedValueOmitted=true;
            return result;
        }
        function findComp(id) {
            var item, i;
            if (typeof id === "undefined" || id === null) { item=app.project.activeItem; return instance(item,"CompItem") ? item : null; }
            integer(id,0,1,2147483647);
            for(i=1;i<=app.project.numItems;i++) { item=app.project.item(i); if(item.id===id && instance(item,"CompItem")) return item; }
            return null;
        }
        function inspect(args) {
            var ident=identity(), scope=args.scope || "activeComp", offset=integer(args.offset,0,0,1000000), limit=integer(args.limit,10,1,50), result={identity:ident,observation:"Authored state and existing diagnostics; no render or preview requested.",scope:scope}, items=[], i, comp, layer, group, path;
            if (!app.project) { result.project=null; return {ok:true,data:result}; }
            if (scope==="project") {
                result.total=app.project.numItems;
                for(i=offset+1;i<=Math.min(result.total,offset+limit);i++) items.push(itemInfo(app.project.item(i)));
                result.items=items;
            } else if(scope==="activeComp" || scope==="comp" || scope==="layer") {
                comp=findComp(args.compId);
                if(!comp) { result.activeComp=null; result.message="No matching composition is active or available."; result.total=0; return {ok:true,data:result}; }
                result.comp=itemInfo(comp); result.comp.width=comp.width;result.comp.height=comp.height;result.comp.frameRate=comp.frameRate;result.comp.duration=comp.duration;result.comp.numLayers=comp.numLayers;
                if(scope!=="layer") {
                    result.total=comp.numLayers;
                    for(i=offset+1;i<=Math.min(result.total,offset+limit);i++) items.push(layerInfo(comp.layer(i)));
                    result.layers=items;
                } else {
                    i=integer(args.layerIndex,1,1,comp.numLayers);layer=comp.layer(i);result.layer=layerInfo(layer);group=layer;path=args.propertyPath || [];
                    if(!(path instanceof Array) || path.length>12) throw Error("Invalid property path");
                    for(i=0;i<path.length;i++) { if(typeof path[i]!=="string" && typeof path[i]!=="number") throw Error("Invalid property path"); group=group.property(path[i]); if(!group) throw Error("Property path not found"); }
                    if(group.propertyType===PropertyType.PROPERTY) { result.property=propertyInfo(group);result.total=1; }
                    else { result.total=group.numProperties; for(i=offset+1;i<=Math.min(result.total,offset+limit);i++) items.push(propertyInfo(group.property(i)));result.properties=items; }
                }
            } else throw Error("Unknown inspection scope");
            result.offset=offset;result.limit=limit;result.hasMore=offset+limit<result.total;
            return {ok:true,data:result};
        }
        function execute(args) {
            if(typeof args.id!=="string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(args.id)) return error("invalid_execution_id","Invalid execution identity.",false);
            if(own(used,"op:"+args.id)) return error("already_consumed","This execution identity has already been consumed. It was not run again.",false);
            if(usedCount>=10000) return error("execution_capacity","This host session reached its execution limit. Restart AE before further edits.",false);
            if(typeof args.source!=="string" || !args.source.length || args.source.length>60000) return error("invalid_source","Script source must contain 1 to 60000 characters.",false);
            if(typeof args.expectedProjectToken!=="string" || args.expectedProjectToken!==identity().projectToken) return error("project_changed","The target project changed. Request and review a new proposal.",false);
            used["op:"+args.id]=true;usedCount++;var begun=false, result;
            try {
                app.beginUndoGroup("Ae-lm: " + cut(args.title || "Reviewed script",100));begun=true;
                result=(new Function(args.source))();
                return {ok:true,data:{id:args.id,execution:"completed",result:typeof result==="undefined" ? null : result,identity:identity(),verification:"Execution returned. Inspect authored state separately to verify the intended change."}};
            } catch(ex) { return error("script_failed",cut(ex.toString(),1500)+(ex.line ? " (line " + ex.line + ")" : "")+" Earlier edits may remain; no automatic rollback was attempted.",true); }
            finally { if(begun) { try { app.endUndoGroup(); } catch(_) {} } }
        }
        function resultPreview(value, level, depth) {
            var text=stringify(value), count, i, key, sample, total=0;
            if(text.length<=level.inline) return value;
            if(typeof value==="string") return {_aelmOmitted:"string",capturedCharacters:value.length,preview:value.substring(0,level.text)};
            if(value instanceof Array) {
                count=depth ? Math.min(value.length,level.items) : 0;sample=[];
                for(i=0;i<count;i++) sample.push(resultPreview(value[i],level,depth-1));
                return {_aelmOmitted:"array",capturedItems:value.length,omittedCapturedItems:value.length-count,preview:sample};
            }
            if(value && typeof value==="object") {
                sample={};count=0;
                for(key in value) if(own(value,key)) { total++; if(depth && count<level.fields) { sample[key]=resultPreview(value[key],level,depth-1);count++; } }
                return {_aelmOmitted:"object",capturedFields:total,omittedCapturedFields:total-count,preview:sample};
            }
            return value;
        }
        function serializeReply(reply, method) {
            var limits={partial:false}, text=stringify(reply,0,[],limits), copy, data, values={}, fields=[], levels, i, j;
            if(text.length<=100000 && !limits.partial) return text;
            if(!reply.ok) return text;
            // Work on plain serialized data: never run the command again or walk
            // arbitrary host getters a second time. This is a partial capture,
            // unlike context-only reduction of an already captured local receipt.
            copy=parse(text);data=copy.data;
            copy._aelmHost={partial:true,fullResultAvailable:false,
                note:"Output was partially captured by the host bridge. Omitted values are unknown, not empty. The full omitted output is not saved. Do not repeat a completed script; request only missing properties with a smaller inspection."};
            text=stringify(copy);
            if(text.length<=100000) return text;
            if(method==="execute" && data && data.execution==="completed") fields=["result"];
            else if(method==="inspect" && data) fields=["items","layers","properties","property"];
            for(j=0;j<fields.length;j++) if(own(data,fields[j])) values[fields[j]]=data[fields[j]];
            levels=[{inline:256,text:400,items:8,fields:12,depth:5},{inline:100,text:100,items:3,fields:6,depth:3},{inline:0,text:0,items:0,fields:0,depth:0}];
            for(i=0;i<levels.length;i++) {
                for(j=0;j<fields.length;j++) if(own(values,fields[j])) copy.data[fields[j]]=resultPreview(values[fields[j]],levels[i],levels[i].depth);
                text=stringify(copy);
                if(text.length<=24000 || (i===levels.length-1 && text.length<=100000)) return text;
            }
            return stringify(error("result_too_large","The host operation returned, but its result metadata exceeded the reply limit. Do not repeat it; inspect only the required state.",method==="execute"));
        }
        function dispatch(method,argsText) {
            var reply, result;
            try {
                if(typeof argsText!=="string" || argsText.length>110000) throw Error("Invalid host request");
                var args=parse(argsText);if(!args || typeof args!=="object" || args instanceof Array) throw Error("Host arguments must be an object");
                if(method==="identity") reply={ok:true,data:identity()};
                else if(method==="inspect") reply=inspect(args);
                else if(method==="execute") reply=execute(args);
                else reply=error("unknown_method","Unknown host operation.",false);
                result=serializeReply(reply,method);
                return result;
            } catch(ex) { return stringify(error("host_request_failed",ex.toString(),method==="execute")); }
        }
        return {dispatch:dispatch};
    }());
}
