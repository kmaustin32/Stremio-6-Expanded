const test = require('node:test');
const assert = require('node:assert/strict');
const {imdbId,absoluteNumber,sources,createLookup} = require('../src/stremio_app/ezra_assets/episode_artwork.js');
const show = {id:'tt0290223',videos:[
    ...Array.from({length:4},(_,index)=>({season:0,episode:index+1})),
    ...[1,2,3].flatMap(season=>Array.from({length:27},(_,index)=>({season,episode:index+1}))),
]};
const episode = number => ({id:`tt0290223:3:${number}`,season:3,episode:number});

test('restores Ezra anime numbering: Inuyasha S3E17 is overall episode 71, excluding specials',()=>{
    assert.equal(absoluteNumber(episode(17),show),71);
    assert.deepEqual(sources(episode(17),show),[
        'https://episodes.metahub.space/tt0290223/3/17/w780.jpg',
        'https://episodes.metahub.space/tt0290223/1/71/w780.jpg',
    ]);
});
test('different episodes get different fallback images even without original thumbnail URLs',()=>{
    assert.match(sources(episode(1),show)[1],/\/1\/55\/w780.jpg$/);
    assert.match(sources(episode(2),show)[1],/\/1\/56\/w780.jpg$/);
    assert.notEqual(sources(episode(1),show)[1],sources(episode(2),show)[1]);
});
test('deduplicates episode entries and refuses to guess offsets from incomplete seasons',()=>{
    assert.equal(absoluteNumber(episode(17),{...show,videos:[...show.videos,...show.videos]}),71);
    assert.equal(absoluteNumber(episode(17),{...show,videos:show.videos.filter(v=>v.season!==1)}),null);
    assert.equal(absoluteNumber(episode(17),{...show,videos:show.videos.filter(v=>v.season!==1||v.episode!==9)}),null);
});
test('does not renumber specials, season one, unknown identifiers or conflicting shows',()=>{
    assert.equal(absoluteNumber({season:0,episode:1},show),null);
    assert.equal(absoluteNumber({season:1,episode:1},show),null);
    assert.deepEqual(sources({id:'kitsu:11:84',season:3,episode:1},{id:'kitsu:11'}),[]);
    assert.equal(imdbId(episode(1),{id:'tt0433309'}),null);
    assert.deepEqual(sources(episode(1),{id:'tt0433309'}),[]);
});
test('shares and caches public episode metadata without account credentials',async()=>{
    let count=0, now=100000;
    const lookup=createLookup(async(url,options)=>{
        count++;
        assert.equal(url,'https://v3-cinemeta.strem.io/meta/series/tt0290223.json');
        assert.equal(options.credentials,'omit');
        assert.equal(options.referrerPolicy,'no-referrer');
        return {ok:true,json:async()=>({meta:show})};
    },()=>now);
    const [first,second]=await Promise.all([lookup(show.id),lookup(show.id)]);
    assert.equal(count,1);
    assert.equal(first,second);
    assert.equal(absoluteNumber(episode(17),first),71);
    now+=16*60000;
    await lookup(show.id);
    assert.equal(count,2);
});
test('handles unavailable or mismatched metadata and bounds failure retries',async()=>{
    let count=0, now=100000;
    const lookup=createLookup(async()=>{count++;throw Error('offline');},()=>now);
    assert.equal(await lookup(show.id),null);
    assert.equal(await lookup(show.id),null);
    assert.equal(count,1);
    now+=60001;
    assert.equal(await lookup(show.id),null);
    assert.equal(count,2);
    assert.equal(await lookup('private:stream-token'),null);
    assert.equal(count,2);
    const mismatch=createLookup(async()=>({ok:true,json:async()=>({meta:{id:'tt0433309',videos:[]}})}));
    assert.equal(await mismatch(show.id),null);
});
