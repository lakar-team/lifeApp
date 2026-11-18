import sqlite3, json, re, sys, collections
db, out = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db)
def pri_score(tags):
    best = 99
    for t in tags:
        if t in ('news1','ichi1','spec1','gai1'): best = min(best,1)
        elif t in ('news2','ichi2','spec2','gai2'): best = min(best,3)
        elif t.startswith('nf'):
            try: best = min(best, 1 + int(t[2:])//6)   # nf01-05→1 ... nf48→9
            except: pass
    return best
kj = collections.defaultdict(list); kn = collections.defaultdict(list)
kjp = collections.defaultdict(list); knp = collections.defaultdict(list)
for i,s,t in c.execute("select ID,idseq,text from Kanji"): kj[s].append((i,t))
for i,s,t,nk in c.execute("select ID,idseq,text,nokanji from Kana"): kn[s].append((i,t))
for k,t in c.execute("select kid,text from KJP"): kjp[k].append(t)
for k,t in c.execute("select kid,text from KNP"): knp[k].append(t)
bad_kana = {k for (k,) in c.execute("select kid from KNI where text like '%obsolete%'")}
bad_kanji = {k for (k,) in c.execute("select kid from KJI where text like '%irregular%' or text like '%outdated%' or text like '%rarely%' or text like '%search-only%'")}
senses = collections.defaultdict(list)
glosses = collections.defaultdict(list)
for sid,seq in c.execute("select ID,idseq from Sense order by ID"): senses[seq].append(sid)
for sid,lang,t in c.execute("select sid,lang,text from SenseGloss where lang='eng' or lang is null or lang=''"): glosses[sid].append(t)
poss = collections.defaultdict(list)
for sid,t in c.execute("select sid,text from pos"): poss[sid].append(t)

W = {}      # word -> [score, gloss, reading, pos]
R = collections.defaultdict(list)   # english -> [(score, jp, reading)]
def clean(g): return re.sub(r'\s*\([^)]*\)','',g).strip()
for seq in kn:
    sids = senses.get(seq, [])
    if not sids: continue
    # glosses: up to 3 senses, up to 2 glosses each (parentheticals kept short)
    parts=[]
    for sid in sids[:3]:
        gs=[g for g in glosses[sid] if g][:2]
        if gs: parts.append("; ".join(gs))
    if not parts: continue
    gloss=" | ".join(parts)
    pos = poss[sids[0]][0] if poss[sids[0]] else ""
    kana=[(i,t) for i,t in kn[seq] if i not in bad_kana] or kn[seq]
    reading=kana[0][1]
    sc_kana=min([pri_score(knp[i]) for i,_ in kana]+[99])
    forms=[]
    for i,t in kj.get(seq,[]):
        if i in bad_kanji: continue
        forms.append((t,min(pri_score(kjp[i]),sc_kana if sc_kana<99 else 99) if kjp[i] else 50))
    for i,t in kana:
        forms.append((t, pri_score(knp[i]) if knp[i] else 60))
    for w,sc in forms:
        if w not in W or sc < W[w][0]:
            W[w]=[sc,gloss,reading,pos]
    # reverse index only for reasonably common entries
    best=min([f[1] for f in forms]+[99])
    if best<=9:
        jp = next((t for t,_ in forms if re.search(r'[一-鿿]',t) and False), None)
        disp = (kj[seq][0][1] if kj.get(seq) and best<50 and kj[seq][0][0] not in bad_kanji else reading)
        for si,sid in enumerate(sids[:4]):
            for gi,g in enumerate([g for g in glosses[sid] if g][:3]):
                key=clean(g).lower()
                key=re.sub(r'^(to|a|an|the) ','',key)
                if 0<len(key)<=30:
                    R[key].append((best*10+si*3+gi + (25 if re.fullmatch(r'[\u30a0-\u30ff\u30fc]+', disp) else 0), disp, reading))
# keep W: priority entries fully; others keep only 1st sense to save space
for w,v in list(W.items()):
    if v[0] >= 50: del W[w]
    else: v[1]=v[1][:140]
rev={}
for k,lst in R.items():
    lst.sort(); seen=set(); top=[]
    for sc,jp,rd in lst:
        if jp in seen: continue
        seen.add(jp); top.append([jp,rd])
        if len(top)==3: break
    rev[k]=top
json.dump({"w":{k:([v[1],v[2]] if v[2]!=k else [v[1]]) for k,v in W.items()}}, open(out+'/ja.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump({"r":rev}, open(out+'/en.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(len(W),len(rev))
