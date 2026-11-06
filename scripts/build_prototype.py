import json,base64,os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
css=open(R+'src/styles.css').read()
body=open(R+'scripts/body.html').read().replace('%CREST%','data:image/png;base64,'+base64.b64encode(open(R+'public/crest.png','rb').read()).decode())
groups=[{"id":"U9","label":"Under 9","band":"U9–U10"},{"id":"U10","label":"Under 10","band":"U9–U10"},{"id":"U11","label":"Under 11","band":"U11–U13"},{"id":"U12","label":"Under 12","band":"U11–U13"},{"id":"U13","label":"Under 13","band":"U11–U13"},{"id":"U13G","label":"Under 13 Girls","band":"U11–U13","mixed":True}]
data={"groups":groups,"attrs":json.load(open(R+'data/attributes.json')),"squads":{g:[{k:v for k,v in pl.items() if k!="dob"} for pl in lst] for g,lst in json.load(open(R+'data/squads.json')).items()}}
js="window.MELITA_DATA="+json.dumps(data,ensure_ascii=False)+";\n"+open(R+'src/store-demo.js').read()+"\n"+open(R+'src/report.js').read()+"\n"+open(R+'src/main.js').read()
html=f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Melita Player Rating</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>{css}</style></head>
{body}<script>{js}</script>
</body></html>'''
open(R+'prototype.html','w').write(html)
print(len(html))
