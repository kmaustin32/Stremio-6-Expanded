(() => {
    'use strict';
    function patch(source) {
        const gates = [...source.matchAll(/null!==(\w+)&&!(\w+)&&(\w+)\.bingeWatching&&\3\.nextVideoNotificationDuration>0/g)];
        if (gates.length !== 1) throw Error('Unrecognized next-episode visibility contract');
        const [gate,next,dismissed,settings] = gates[0];
        const live = new RegExp(`nextVideo:${next},isEpg:(\\w+),onDismiss:`).exec(source)?.[1];
        if (!live) throw Error('Unrecognized next-episode live-TV contract');
        const outro = `${settings}.bingeWatching&&null!==`;
        const suppression = new RegExp(`${outro}(\\w+)\\.nextVideo\\|\\|${dismissed}`);
        const matches = [...source.matchAll(new RegExp(suppression.source,'g'))];
        if (matches.length !== 1) throw Error('Unrecognized outro/popup overlap contract');
        source = source.replace(gate,`null!==${next}&&!${dismissed}&&(!${live}||${settings}.bingeWatching)&&${settings}.nextVideoNotificationDuration>0`);
        const replacement = `(${settings}.bingeWatching||${settings}.nextVideoNotificationDuration>0)&&null!==${matches[0][1]}.nextVideo||${dismissed}`;
        source = source.replace(matches[0][0],replacement);
        const position = source.indexOf(replacement);
        const effect = source.lastIndexOf('.useEffect(function',position);
        const deps = source.indexOf('},[',position);
        const end = source.indexOf('])',deps);
        if (effect < 0 || deps < 0 || end < 0 || end-position>2000) throw Error('Unrecognized outro effect');
        const original = source.slice(deps,end);
        if (!original.includes(`${settings}.bingeWatching`)) throw Error('Missing outro settings dependency');
        source = source.slice(0,deps)+original.replace(`${settings}.bingeWatching`,
            `${settings}.bingeWatching,${settings}.nextVideoNotificationDuration`)+source.slice(end);
        return source;
    }
    function install(factories) {
        const candidates = Object.entries(factories).filter(([,factory])=>{
            const source=factory.toString();
            return source.includes('nextVideoNotificationDuration') && source.includes('onNextVideoRequested:') && source.includes('bingeWatching');
        });
        if(candidates.length!==1) return false;
        const [id,factory]=candidates[0];
        const updated=patch(factory.toString());
        // Webpack factories are self-contained. Compile only the recognized public player module;
        // failure leaves the original factory untouched. Preserve its contract for other adapters.
        const expression=updated.replace(/^\d+\(/,'function(');
        const compiled=Function(`"use strict";return (${expression});`)();
        compiled.toString=()=>updated;
        factories[id]=compiled;
        return true;
    }
    if(typeof module!=='undefined' && module.exports) module.exports={patch,install};
    else if(window===window.top && location.origin==='https://web.stremio.com') {
        (window.webpackChunkstremio ||= []).push([['expanded-next-episode'],{},require=>{
            try { window.__stremioExpandedNextEpisode=install(require.m); }
            catch(error) { console.error('Next-episode compatibility check failed.',error); }
        }]);
    }
})();
