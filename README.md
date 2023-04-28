# RML Loose Generator

Proof-of-concept implementation related to paper [Reference conditions: relating mapping rules without joining](https://openreview.net/forum?id=7wQTpBuPRqN) submitted to KGCW 2023

## Prerequisite 

Before starting:
- install [Node.js](https://nodejs.org/en) (we tested with version v18.16.0)
- run `npm install`
- normalize the RML mapping file:[https://github.com/RMLio/rml-normalize](https://github.com/RMLio/rml-normalize)  
Below implementation supposes that the RML mapping file used as input is normalized, e.g., no shortcuts as rr:subject, rr: object, rr:predicate.


## Usage

Our implementation interprets every referencing object map that does not need data from the parent source with reference conditions instead of join conditions
and is limited to referencing object maps with only one join condition, without use of functions, and where the subject of the parent is built with a template. 
Outside of these restrictions, the original semantics of join conditions are preserved.
In the resulting mapping file all refercing object maps that meet the above conditions are converted to crafted URI templates. 

Command line interface:
```
node makeLooseRML.js PATH_TO_INPUT_FILE [PATH_TO_OUTPUT_FILE]
```
Example: 
```
node makeLooseRML.js ./examples/gtfs_mapping.rml.ttl loose_gtfs_mapping.rml.ttl
```

## Author
Els de Vleeschauwer
