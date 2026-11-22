import { main as runTH } from './processing/scenes.ts';
import { main as runTsLogic } from './processing/logic.ts';

function main() {
    try {
        console.log('--- Starting scenes generation ---\n')
        
        runTsLogic()

        runTH()

        console.log('\n--- Scenes generated ---')
    } catch (error) {
        console.error('An error occurred during execution:', error)
    }
}

main()