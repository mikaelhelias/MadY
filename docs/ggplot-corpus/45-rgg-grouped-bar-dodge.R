# R Graph Gallery #48: grouped barchart
library(ggplot2)

specie <- c(rep("sorgho" , 3) , rep("poacee" , 3) , rep("banana" , 3) , rep("triticum" , 3) )
condition <- rep(c("normal" , "stress" , "Nitrogen") , 4)
value <- abs(rnorm(12 , 0 , 15))
data <- data.frame(specie,condition,value)

ggplot(data, aes(fill=condition, y=value, x=specie)) +
    geom_bar(position="dodge", stat="identity")
