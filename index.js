const N3 = require('n3');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');

const QueryEngine = require('@comunica/query-sparql-rdfjs').QueryEngine;
const myEngine = new QueryEngine();

const { DataFactory } = N3;
const { namedNode, literal, quad } = DataFactory;

const prefixes = {
    rr: 'http://www.w3.org/ns/r2rml#',
    rml: 'http://semweb.mmlab.be/ns/rml#',
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
    fno: 'https://w3id.org/function/ontology#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    ex: 'http://mapping.example.com/',
    idlabfn: 'http://example.com/idlab/function/',
    fnml: 'http://semweb.mmlab.be/ns/fnml#',
    grel: 'http://users.ugent.be/~bjdmeest/function/grel.ttl#',
    ql: 'http://semweb.mmlab.be/ns/ql#',
    d2rq: 'http://www.wiwiss.fu-berlin.de/suhl/bizer/D2RQ/0.1#'
};

let prefixesSPARQL = ''
for (const [key, value ] of Object.entries(prefixes)) {
    prefixesSPARQL += 'PREFIX ' + key + ': <' + value + '>\n';
}

async function putRMLInStore(rml, store){
    let rmlContent = await fsp.readFile(path.resolve(__dirname, rml), 'utf8');
    const parser = new N3.Parser();
    parser.parse(rmlContent,
        (error, quad, prefixes) => {if (quad){store.addQuad(quad);}});
}
function tripleNNL(s, p, o){
    return quad(namedNode(s),namedNode(p), literal(o));
}
function tripleNNN(s, p, o){
    return quad(namedNode(s),namedNode(p), namedNode(o));
}

const queryWorkAroundIssue199 = `${prefixesSPARQL}  
    SELECT * WHERE { 
        ?TriplesMap rml:logicalSource ?LogicalSource.
        ?TriplesMap rr:predicateObjectMap ?Pom.
        ?Pom rr:objectMap ?Om.
        ?Om rr:parentTriplesMap ?TriplesMap.
        ?Om rr:joinCondition ?JoinCondition.
        ?JoinCondition rr:child ?Child.
        ?JoinCondition rr:parent ?Parent.
        ?TriplesMap rr:subjectMap ?SubjectMap.
        FILTER(?Child != ?Parent) .
}`;

// TODO temporary, remove when issue 199 for RML Mapper is solved, test
async function workAroundIssue199(store) {
    const bindingsStream = await myEngine.queryBindings(queryWorkAroundIssue199, {sources: [store]});
    const bindings = await bindingsStream.toArray();
    for (const binding of bindings) {
        store.removeQuad(
            tripleNNN(binding.get('Om').value, prefixes.rr + 'parentTriplesMap', binding.get('TriplesMap').value));
        store.addQuads([
            tripleNNN(binding.get('Om').value, prefixes.rr + 'parentTriplesMap', binding.get('TriplesMap').value + '_issue'),
            tripleNNN(binding.get('TriplesMap').value + '_issue', prefixes.rdf + 'type', prefixes.rr + 'TriplesMap'),
            tripleNNN(binding.get('TriplesMap').value + '_issue', prefixes.rml + 'logicalSource', binding.get('LogicalSource').value),
            tripleNNN(binding.get('TriplesMap').value + '_issue', prefixes.rr + 'subjectMap', binding.get('SubjectMap').value)
        ])
    }
}


const queryNoSelfJoins = `${prefixesSPARQL}  
    SELECT *
    WHERE { 
        ?TriplesMap rml:logicalSource ?LogicalSource.
        ?LogicalSource rml:source ?source .
        OPTIONAL { ?LogicalSource rml:iterator ?Iterator .}
        OPTIONAL { ?LogicalSource rml:query ?Query .}
        ?TriplesMap rr:predicateObjectMap ?Pom.
        ?Pom rr:objectMap ?Om.
        ?Om rr:parentTriplesMap ?ParentTriplesMap.
        OPTIONAL { ?Om rr:joinCondition ?JoinCondition.
        ?JoinCondition rr:child ?Child.
        ?JoinCondition rr:parent ?Parent.}
        ?ParentTriplesMap rml:logicalSource ?ParentLogicalSource.
        ?ParentLogicalSource rml:source ?source .
        OPTIONAL { ?ParentLogicalSource rml:iterator ?ParentIterator .}
        OPTIONAL { ?ParentLogicalSource rml:query ?ParentQuery .}
        ?ParentTriplesMap rr:subjectMap ?ParentSubjectMap.
        ?ParentSubjectMap rr:template ?ParentSubjectTemplate.
}`;

// see https://stackoverflow.com/questions/64270284/sparql-find-subjects-with-the-same-set-of-triples
const queryNoSelfJoinsComplexSource = `${prefixesSPARQL}
    SELECT * WHERE{
        ?TriplesMap rml:logicalSource ?LogicalSource.
        OPTIONAL { ?LogicalSource rml:iterator ?Iterator .}
        OPTIONAL { ?LogicalSource rml:query ?Query .}
        ?TriplesMap rr:predicateObjectMap ?Pom.
        ?Pom rr:objectMap ?Om.
        ?Om rr:parentTriplesMap ?ParentTriplesMap.
        OPTIONAL { ?Om rr:joinCondition ?JoinCondition.
        ?JoinCondition rr:child ?Child.
        ?JoinCondition rr:parent ?Parent.}
        ?ParentTriplesMap rml:logicalSource ?ParentLogicalSource.
        OPTIONAL { ?ParentLogicalSource rml:iterator ?ParentIterator .}
        OPTIONAL { ?ParentLogicalSource rml:query ?ParentQuery .}
        ?ParentTriplesMap rr:subjectMap ?ParentSubjectMap.
        ?ParentSubjectMap rr:template ?ParentSubjectTemplate.  
        ?LogicalSource rml:source ?s1 .
        ?ParentLogicalSource rml:source ?s2 .
        ?s1 ?p ?o .
        ?s2 ?p ?o .
        FILTER NOT EXISTS { ?s1 ?p1 ?o1 . FILTER NOT EXISTS { ?s2 ?p1 ?o1 } }
        FILTER NOT EXISTS { ?s2 ?p2 ?o2 . FILTER NOT EXISTS { ?s1 ?p2 ?o2 } }
}`
const queryNoSelfJoinsComplexSourceR2RML = `${prefixesSPARQL}
    SELECT * WHERE{
        ?TriplesMap rr:logicalTable ?LogicalTable.
        ?TriplesMap rr:predicateObjectMap ?Pom.
        ?Pom rr:objectMap ?Om.
        ?Om rr:parentTriplesMap ?ParentTriplesMap.
        OPTIONAL { ?Om rr:joinCondition ?JoinCondition.
        ?JoinCondition rr:child ?Child.
        ?JoinCondition rr:parent ?Parent.}
        ?ParentTriplesMap rr:logicalTable ?ParentLogicalTable.
        ?ParentTriplesMap rr:subjectMap ?ParentSubjectMap.
        ?ParentSubjectMap rr:template ?ParentSubjectTemplate.  
        ?LogicalTable ?p ?o .
        ?ParentLogicalTable ?p ?o .
        FILTER NOT EXISTS { ?LogicalTable ?p1 ?o1 . FILTER NOT EXISTS { ?ParentLogicalTable ?p1 ?o1 } }
        FILTER NOT EXISTS { ?ParentLogicalTable ?p2 ?o2. FILTER NOT EXISTS { ?LogicalTable ?p2 ?o2 } }
}`

async function eliminateSelfJoins(store) {
    // only for templates, conditions not take into account yet
    const bindingsStream1 = await myEngine.queryBindings(queryNoSelfJoins, {sources: [store]});
    const bindings1 = await bindingsStream1.toArray();
    const bindingsStream2 = await myEngine.queryBindings(queryNoSelfJoinsComplexSource, {sources: [store]});
    const bindings2 = await bindingsStream2.toArray();
    const bindingsStream3= await myEngine.queryBindings(queryNoSelfJoinsComplexSourceR2RML, {sources: [store]});
    const bindings3 = await bindingsStream3.toArray();
    for (const binding of [...bindings1, ...bindings2, ...bindings3]) {
        //identify identical sources: 1. identical sources, part of the query  2. identical iterator (default is row, for csv and tsv)
        let iterator = binding.has('Iterator') ? binding.get('Iterator').value : 'row'; //TODO add this to normalize-rml: default value for CSV and TSV, when done: adapt query
        let parentIterator = binding.has('ParentIterator') ? binding.get('ParentIterator').value : 'row';
        let query = binding.has('Query') ? binding.get('Query').value : 'none';
        let parentQuery = binding.has('ParentQuery') ? binding.get('ParentQuery').value : 'none';
        let child = binding.has('Child') ? binding.get('Child').value : 'none';
        let parent = binding.has('Parent') ? binding.get('Parent').value : 'none';
        if (iterator === parentIterator && query === parentQuery && child === parent ) {
            //console.log('true');
            store.removeQuads([
                tripleNNN(binding.get('Om').value, prefixes.rr + 'parentTriplesMap', binding.get('ParentTriplesMap').value),
                tripleNNN(binding.get('Om').value, prefixes.rdf + 'type', prefixes.rr + 'RefObjectMap')
            ]);
            if (binding.has('JoinCondition')) {
                store.removeQuads([
                    tripleNNN(binding.get('Om').value, prefixes.rr + 'joinCondition', binding.get('JoinCondition').value),
                    tripleNNL(binding.get('JoinCondition').value, prefixes.rr + 'child', binding.get('Child').value),
                    tripleNNL(binding.get('JoinCondition').value, prefixes.rr + 'parent', binding.get('Parent').value)
                ]);
            }
            store.addQuads([
                tripleNNN(binding.get('Om').value, prefixes.rdf + 'type', prefixes.rr + 'ObjectMap'),
                tripleNNL(binding.get('Om').value, prefixes.rr + 'template', binding.get('ParentSubjectTemplate').value),
                tripleNNN(binding.get('Om').value, prefixes.rr + 'termType', prefixes.rr + 'IRI')
            ]);
        }
    }
}

async function eliminateSelfJoinsInclIssue199(store) {
    await workAroundIssue199(store);
    await eliminateSelfJoins(store);
}

const queryLooseRML = `${prefixesSPARQL}
    SELECT * WHERE { 
    ?Om rr:parentTriplesMap ?ParentTriplesMap.
    ?Om rr:joinCondition ?JoinCondition.
    ?JoinCondition rr:child ?Child.
    ?JoinCondition rr:parent ?Parent.
    ?ParentTriplesMap rr:subjectMap ?ParentSubjectMap.
    ?ParentSubjectMap rr:template ?ParentSubjectTemplate
}`

async function makeLooseRML(store) {
    await eliminateSelfJoins(store);
    const bindingsStream = await myEngine.queryBindings(queryLooseRML, {sources: [store]});
    const bindings = await bindingsStream.toArray();
    for (const binding of bindings) {
        const parentSubjectTemplate = binding.get('ParentSubjectTemplate').value;
        const parentRef = "{" + binding.get('Parent').value + "}";
        const references = parentSubjectTemplate.match(/\{.*?\}/ug);
        //when parentSubjectTemplate has only parentReferences , ny conditions not taken into account
        if (references.every((r) => r === parentRef)) {
            const newTemplate = parentSubjectTemplate.replaceAll(parentRef,
                "{" + binding.get('Child').value + "}");
            store.removeQuads([
                tripleNNN(binding.get('Om').value, prefixes.rdf + 'type', prefixes.rr + 'RefObjectMap'),
                tripleNNN(binding.get('Om').value, prefixes.rr + 'parentTriplesMap', binding.get('ParentTriplesMap').value),
                tripleNNN(binding.get('Om').value, prefixes.rr + 'joinCondition', binding.get('JoinCondition').value),
                tripleNNL(binding.get('JoinCondition').value, prefixes.rr + 'child', binding.get('Child').value),
                tripleNNL(binding.get('JoinCondition').value, prefixes.rr + 'parent', binding.get('Parent').value)]);
            store.addQuads([
                tripleNNN(binding.get('Om').value, prefixes.rdf + 'type', prefixes.rr + 'ObjectMap'),
                tripleNNL(binding.get('Om').value, prefixes.rr + 'template', newTemplate),
                tripleNNN(binding.get('Om').value, prefixes.rr + 'termType', prefixes.rr + 'IRI')]);
        }
    }
}

function writeNewRMLToTerminal(store) {
   const writer = new N3.Writer({prefixes: prefixes});
   for (const quad of store) {
       writer.addQuad(quad);
       }
   writer.end((error, result) => {console.log(result);});
}

function writeNewRML(store, out) {
   const writer = new N3.Writer({prefixes: prefixes});
   for (const quad of store) {
       writer.addQuad(quad);
       }
   writer.end((error, result) => {
       fs.writeFile(out, result, (err) => {
        if (err) throw err;});
        });
}


function cli(myFunction){
    if (!process.argv[2]) {
        console.error('Please give the path to the rml file as first argument!');
        process.exit(-1);
    }
    const rml = process.argv[2];
    const out = process.argv[3];
    const store = new N3.Store();
    putRMLInStore(rml, store).then(()=>
        myFunction(store).then(() => {
                if (process.argv[3]) {
                    writeNewRML(store, out);
                } else {
                    writeNewRMLToTerminal(store);
                }
            }
            ));
}
module.exports = { workAroundIssue199, eliminateSelfJoins, eliminateSelfJoinsInclIssue199, makeLooseRML, cli };
