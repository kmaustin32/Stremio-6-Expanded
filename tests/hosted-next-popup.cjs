const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const script=fs.readFileSync(path.join(__dirname,'../src/stremio_app/ezra_assets/next_episode.js'),'utf8');
const {patch}=require('../src/stremio_app/ezra_assets/next_episode.js');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:[process.env.STREMIO_TEST_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p))});
 try {
  const page=await browser.newPage();
  await page.addInitScript({content:`(window.webpackChunkstremio ||= []).push([['next-fixture'],{},require=>{
   window.nextRequire=require;
   window.nextOriginal=Object.values(require.m).find(f=>f.toString().includes('nextVideoNotificationDuration')&&f.toString().includes('onNextVideoRequested:')&&f.toString().includes('bingeWatching')).toString();
  }]);\n`+script});
  await page.goto('https://web.stremio.com/');
  await page.waitForFunction(()=>window.__stremioExpandedNextEpisode===true);
  const original=await page.evaluate(()=>window.nextOriginal);
  const updated=patch(original);
  const gate=/null!==(\w+)&&!(\w+)&&(\w+)\.bingeWatching&&\3\.nextVideoNotificationDuration>0/.exec(original);
  const [,next,dismissed,settings]=gate;
  const live=new RegExp(`nextVideo:${next},isEpg:(\\w+),onDismiss:`).exec(original)[1];
  const tail=original.slice(gate.index).split(',')[0];
  const timing=/null!==(\w+)&&null!==(\w+)\.state.time.*?\|\|null!==(\w+)/.exec(tail);
  const [,outro,video,remaining]=timing;
  const start=updated.indexOf(`null!==${next}&&!${dismissed}&&`);
  const expression=updated.slice(start).split(',')[0];
  const evaluate=Function(next,dismissed,settings,live,outro,video,remaining,`return ${expression}`);
  const visible=({auto=false,duration=10000,hasNext=true,closed=false,isLive=false,time=95000,length=100000,outroAt=null}={})=>
   evaluate(hasNext?{}:null,closed,{bingeWatching:auto,nextVideoNotificationDuration:duration},isLive,outroAt,{state:{time}},length-time);
  assert.equal(visible(),true,'Manual popup appears with Auto Play off');
  assert.equal(visible({auto:true}),true,'Auto Play on keeps its popup');
  assert.equal(visible({time:50000}),false,'No early popup');
  assert.equal(visible({time:89999}),false);
  assert.equal(visible({time:90000}),true,'Uses the configured countdown threshold');
  assert.equal(visible({duration:0}),false,'Disabled stays disabled');
  assert.equal(visible({hasNext:false}),false,'Final episode has no prompt');
  assert.equal(visible({closed:true}),false,'Dismissal remains effective');
  assert.equal(visible({isLive:true}),false,'Live-TV behavior unchanged');
  assert.equal(visible({isLive:true,auto:true}),true);
  assert.equal(visible({time:70000,outroAt:60000}),true,'Known outro can trigger the prompt');
  assert.equal(visible({time:100000}),false,'End-of-file behavior unchanged');
  assert.equal(visible({time:20000}),false,'Seeking back hides the prompt');
  const outroGuard=new RegExp(`\\(${settings}\\.bingeWatching\\|\\|${settings}\\.nextVideoNotificationDuration>0\\)&&null!==(\\w+)\\.nextVideo\\|\\|${dismissed}`).exec(updated);
  assert.ok(outroGuard,'Manual next prompt does not overlap Skip Outro');
  assert.ok(updated.includes(`${settings}.bingeWatching,${settings}.nextVideoNotificationDuration`),'Duration updates refresh the outro effect');
  // The automatic end handler and manual Next callbacks must remain byte-for-byte intact.
  let callbacks=0;
  for(const match of original.matchAll(/\.useCallback\(function\(\)\{[^]*?\},\[[^\]]*\]\)/g)) {
   if(match[0].includes('.nextVideo.deepLinks')) { callbacks++; assert.ok(updated.includes(match[0]),'Preserve native navigation and autoplay callbacks'); }
  }
  assert.ok(callbacks>=2,'Recognize both automatic-end and manual-next handlers');
  assert.throws(()=>patch('unknown player'),/Unrecognized/);
  assert.throws(()=>patch(original+original),/Unrecognized/);
  console.log('PASS: current hosted player manual/automatic popup timing, Disabled, dismissal, final episode, seeking, live TV, outro overlap and unchanged end/navigation callbacks.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
