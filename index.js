const N3 = require('n3');
const fsp = require('fs/promises');
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
    SELECT * WHERE { 
        ?TriplesMap rml:logicalSource ?LogicalSource.
        ?LogicalSource rml:source ?source .
        OPTIONAL { ?LogicalSource rml:iterator ?Iterator .}
        ?TriplesMap rr:predicateObjectMap ?Pom.
        ?Pom rr:objectMap ?Om.
        ?Om rr:parentTriplesMap ?ParentTriplesMap.
        OPTIONAL { ?Om rr:joinCondition ?JoinCondition.
        ?JoinCondition rr:child ?Child.
        ?JoinCondition rr:parent ?Parent.}
        ?ParentTriplesMap rml:logicalSource ?ParentLogicalSource.
        ?ParentLogicalSource rml:source ?source .
        OPTIONAL { ?ParentLogicalSource rml:iterator ?ParentIterator .}
        ?ParentTriplesMap rr:subjectMap ?ParentSubjectMap.
        ?ParentSubjectMap rr:template ?ParentSubjectTemplate.
}`;


async function eliminateSelfJoins(store) {
    await workAroundIssue199(store);
    // only for templates, conditions not take into account yet
    const bindingsStream = await myEngine.queryBindings(queryNoSelfJoins, {sources: [store]});
    const bindings = await bindingsStream.toArray();
    for (const binding of bindings) {
        //identify identical sources: 1. identical sources, part of the query  2. identical iterator (default is row, for csv and tsv)
        let iterator = 'row'; //TODO add this to normalize-rml: default value for CSV and TSV, when done: adapt query
        let parentIterator = 'row';
        if (binding.has('Iterator')){iterator = binding.get('Iterator').value};
        if (binding.has('ParentIterator')){parentIterator = binding.get('ParentIterator').value};
        if (iterator === parentIterator) {
            if (!binding.has('Child') || binding.get('Child').value === binding.get('Parent').value) {
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

function writeNewRML(store) {
   const writer = new N3.Writer({prefixes: prefixes});
   for (const quad of store) {
       writer.addQuad(quad);
       }
   writer.end((error, result) => {console.log(result);});
}
function cli(myFunction){
    if (!process.argv[2]) {
        console.error('Please give the path to the rml file as first argument!');
        process.exit(-1);
    }
    const rml = process.argv[2];
    const store = new N3.Store();
    putRMLInStore(rml, store).then(()=>
        myFunction(store).then(() => writeNewRML(store)));
}
module.exports = { workAroundIssue199, eliminateSelfJoins, makeLooseRML, cli };
