-- A starter workflow, so a fresh clone shows something working instead of an
-- empty screen. Safe to run repeatedly: it does nothing if the name is taken.
INSERT INTO workflows (name, nodes, connections)
SELECT
  'Hello weather',
  '[{"name":"Start","type":"manualTrigger","parameters":{},"position":{"x":80,"y":160}},
    {"name":"Weather","type":"httpRequest",
     "parameters":{"url":"https://wttr.in/Newcastle?format=j1","method":"GET","timeout":15000,"retries":2},
     "position":{"x":400,"y":160}},
    {"name":"Tidy up","type":"set",
     "parameters":{"keepOnlySet":true,"fields":[
        {"name":"city","type":"string","value":"Newcastle"},
        {"name":"temperature","type":"string","value":"{{ $json.current_condition[0].temp_C }} C"},
        {"name":"feelsLike","type":"string","value":"{{ $json.current_condition[0].FeelsLikeC }} C"}]},
     "position":{"x":720,"y":160}}]'::jsonb,
  '{"Start":[["Weather"]],"Weather":[["Tidy up"]]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM workflows WHERE name = 'Hello weather');
